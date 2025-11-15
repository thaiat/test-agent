import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here'
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Store for accumulating full responses
const responseStore = new Map();

// Example tools for the agent
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather in a given location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'The unit of temperature'
          }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform a mathematical calculation',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate, e.g. "2 + 2" or "10 * 5"'
          }
        },
        required: ['expression']
      }
    }
  }
];

// Tool implementations
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'get_weather':
      // Simulate weather API call
      return {
        location: args.location,
        temperature: Math.floor(Math.random() * 30) + 10,
        unit: args.unit || 'celsius',
        condition: 'sunny'
      };
    
    case 'calculate':
      try {
        // Safe evaluation - in production, use a proper math parser
        const result = Function(`"use strict"; return (${args.expression})`)();
        return {
          expression: args.expression,
          result: result
        };
      } catch (error) {
        return {
          expression: args.expression,
          error: 'Invalid expression'
        };
      }
    
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Streaming endpoint
app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Generate a conversation ID if not provided
  const id = conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Initialize response accumulator
  const fullResponse = {
    id,
    messages: [],
    toolCalls: [],
    finalAnswer: null,
    timestamp: new Date().toISOString()
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in nginx

  try {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant. Always respond with structured JSON when possible.'
      },
      {
        role: 'user',
        content: message
      }
    ];

    // Recursive function to handle streaming with tool calls
    async function streamWithTools(messages, maxIterations = 10) {
      if (maxIterations <= 0) {
        throw new Error('Maximum tool call iterations reached');
      }

      const stream = await openai.beta.chat.completions.stream({
        model: 'gpt-4o',
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        stream: true,
        response_format: { type: 'json_object' }
      });

      let accumulatedContent = '';
      const currentToolCalls = [];

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index || 0;
            
            if (!currentToolCalls[index]) {
              currentToolCalls[index] = {
                id: toolCallDelta.id || '',
                type: 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: ''
                }
              };
            }

            if (toolCallDelta.function?.name) {
              currentToolCalls[index].function.name = toolCallDelta.function.name;
            }

            if (toolCallDelta.function?.arguments) {
              currentToolCalls[index].function.arguments += toolCallDelta.function.arguments;
            }
          }
        }

        // Handle content
        if (delta.content) {
          accumulatedContent += delta.content;
          
          // Stream content chunks to client
          res.write(`data: ${JSON.stringify({
            type: 'content',
            content: delta.content,
            accumulated: accumulatedContent
          })}\n\n`);
        }

        // Handle finish reason
        if (choice.finish_reason === 'tool_calls' && currentToolCalls.length > 0) {
          // Add assistant message with tool calls
          const assistantMessage = {
            role: 'assistant',
            content: null,
            tool_calls: currentToolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            }))
          };
          messages.push(assistantMessage);

          // Store tool calls in full response
          currentToolCalls.forEach(tc => {
            fullResponse.toolCalls.push({
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            });
          });

          // Execute tool calls
          for (const toolCall of currentToolCalls) {
            if (toolCall.function.name) {
              try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const toolResult = await executeTool(toolCall.function.name, args);
                
                // Stream tool execution info
                res.write(`data: ${JSON.stringify({
                  type: 'tool_call',
                  tool: toolCall.function.name,
                  arguments: args,
                  result: toolResult
                })}\n\n`);

                // Add tool result to messages
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult)
                });
              } catch (error) {
                console.error('Tool execution error:', error);
                res.write(`data: ${JSON.stringify({
                  type: 'error',
                  error: `Tool execution failed: ${error.message}`
                })}\n\n`);
                
                // Add error to messages
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ error: error.message })
                });
              }
            }
          }

          // Recursively continue with tool results
          return await streamWithTools(messages, maxIterations - 1);
        }
      }

      // Store assistant message if there's content
      if (accumulatedContent) {
        messages.push({
          role: 'assistant',
          content: accumulatedContent
        });
      }

      return accumulatedContent;
    }

    // Start streaming
    const finalContent = await streamWithTools(messages);

    // Store final response
    fullResponse.finalAnswer = finalContent;
    fullResponse.messages = messages;
    
    // Try to parse as JSON
    try {
      fullResponse.parsedJson = JSON.parse(finalContent);
    } catch (e) {
      // Not valid JSON, that's okay
      fullResponse.parsedJson = null;
    }

    // Log the full JSON response
    console.log('\n=== FULL RESPONSE LOG ===');
    console.log(JSON.stringify(fullResponse, null, 2));
    console.log('========================\n');

    // Store in response store
    responseStore.set(id, fullResponse);

    // Send final message
    res.write(`data: ${JSON.stringify({
      type: 'done',
      conversationId: id,
      fullResponse: fullResponse
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

// Endpoint to retrieve full conversation
app.get('/api/conversation/:id', (req, res) => {
  const { id } = req.params;
  const conversation = responseStore.get(id);
  
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  res.json(conversation);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Make sure to set OPENAI_API_KEY environment variable`);
});
