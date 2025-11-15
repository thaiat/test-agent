# OpenAI Agent with Streaming JSON Responses

A Node.js backend with OpenAI SDK that streams structured JSON responses to a simple JavaScript frontend. Supports tool calls and logs the full JSON response at the end of each interaction.

## Features

- ✅ Streaming responses using Server-Sent Events (SSE)
- ✅ Structured JSON output
- ✅ Tool call support (weather, calculator examples included)
- ✅ Full JSON logging at end of interaction
- ✅ Simple JavaScript frontend
- ✅ Real-time updates as the agent responds

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set your OpenAI API key:
```bash
export OPENAI_API_KEY=your-api-key-here
```

Or create a `.env` file:
```
OPENAI_API_KEY=your-api-key-here
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

## How It Works

### Backend (`server.js`)
- Express server with SSE endpoint `/api/chat`
- Uses OpenAI SDK with streaming enabled
- Handles tool calls and executes them
- Streams content chunks as they arrive
- Accumulates full response and logs it at the end
- Stores conversations for later retrieval

### Frontend (`public/index.html`)
- Simple HTML/JavaScript interface
- Connects to SSE endpoint
- Displays streamed content in real-time
- Shows tool calls and results
- Displays JSON preview
- Logs full response to browser console

## API Endpoints

### POST `/api/chat`
Streams the agent's response.

**Request:**
```json
{
  "message": "What's the weather in San Francisco?",
  "conversationId": "optional-conversation-id"
}
```

**Response:** Server-Sent Events stream with:
- `content` chunks as they arrive
- `tool_call` events when tools are executed
- `done` event with full response at the end

### GET `/api/conversation/:id`
Retrieves a stored conversation.

## Example Usage

Ask questions like:
- "What's 15 * 23?"
- "What's the weather in New York?"
- "Tell me about artificial intelligence in JSON format"

The agent will stream its response in real-time, execute any necessary tools, and log the complete JSON response at the end.

## Notes

- The agent is configured to return JSON format (`response_format: { type: 'json_object' }`)
- Tool calls are executed automatically when detected
- Full responses are logged to both server console and browser console
- Conversations are stored in memory (restart clears them)
