import type { ChatEvent } from '@chatkit/core';

// A tiny inline SVG so the file-handling fixture has something real to
// render without depending on an external image host (keeps e2e runs
// network-independent) or a binary asset file in the repo. Encoded with
// btoa() rather than Buffer — this module is bundled into the client, and
// Buffer isn't a browser global.
const DEMO_IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">' +
  '<rect width="320" height="160" fill="#4f46e5"/>' +
  '<text x="160" y="85" font-family="sans-serif" font-size="18" fill="#ffffff" text-anchor="middle">chatkit demo image</text>' +
  '</svg>';
const DEMO_IMAGE_DATA_URL = `data:image/svg+xml;base64,${btoa(DEMO_IMAGE_SVG)}`;

export const FIXTURE_NAMES = [
  'text-streaming',
  'markdown',
  'tool-call',
  'file-handling',
  'forms',
  'documents',
  'hitl-approval',
  'kitchen-sink',
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const formSchema = {
  type: 'object',
  required: ['destination'],
  properties: {
    destination: { type: 'string', title: 'Destination' },
    travelers: { type: 'number', title: 'Travelers', minimum: 1 },
    cabin: { type: 'string', title: 'Cabin', enum: ['economy', 'business', 'first'] },
  },
};

export const fixtures: Record<FixtureName, ChatEvent[]> = {
  'text-streaming': [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 'text-streaming' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hello! ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'This is a plain streamed reply, ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'rendered token by token.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'RUN_FINISHED', runId: 'r1' },
  ],

  markdown: [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 'markdown' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Here is some **bold**, *italic*, and `inline code`.\n\n' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'A [link](https://example.com) too.\n\n' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '```js\nconsole.log("hello");\n```\n' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'RUN_FINISHED', runId: 'r1' },
  ],

  'tool-call': [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 'tool-call' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'search_flights', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"origin":"SFO","destination":"NRT"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', result: { flights: 3 } },
    { type: 'RUN_FINISHED', runId: 'r1' },
  ],

  'file-handling': [
    {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          createdAt: Date.now(),
          streaming: false,
          parts: [
            { type: 'text', text: 'Here is a photo and a report:' },
            { type: 'image', url: DEMO_IMAGE_DATA_URL, alt: 'Sample image', mimeType: 'image/svg+xml' },
            {
              type: 'file',
              url: 'data:application/pdf;base64,JVBERi0xLjQK',
              name: 'report.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 102400,
            },
          ],
        },
      ],
    },
  ],

  forms: [
    {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: {
        artifactId: 'form-1',
        createdByMessageId: 'm1',
        data: {
          schema: formSchema,
          mode: 'single-submit',
          submitLabel: 'Book it',
          initialValues: { cabin: 'economy' },
        },
      },
    },
  ],

  documents: [
    {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: {
        artifactId: 'doc-1',
        createdByMessageId: 'm1',
        data: {
          title: 'Trip Itinerary',
          format: 'markdown',
          content: '**Day 1**\n\nArrive in Tokyo.\n\n**Day 2**\n\nVisit temples.',
          editable: true,
          exportFormats: ['md', 'txt'],
        },
      },
    },
  ],

  'hitl-approval': [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 'hitl-approval' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'I need permission before I can do this.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"path":"/tmp/old-report.pdf"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    // No RUN_FINISHED — a real server would hold the run open while
    // waiting on the approval, same as this fixture.
  ],

  'kitchen-sink': [
    { type: 'RUN_STARTED', runId: 'r1', threadId: 'kitchen-sink' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Fill this out to start planning:' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    {
      type: 'CUSTOM',
      name: 'chatkit.form.snapshot',
      payload: {
        artifactId: 'form-1',
        createdByMessageId: 'm1',
        data: { schema: formSchema, mode: 'single-submit', submitLabel: 'Continue' },
      },
    },
    {
      type: 'CUSTOM',
      name: 'chatkit.document.snapshot',
      payload: {
        artifactId: 'doc-1',
        createdByMessageId: 'm1',
        data: {
          title: 'Draft Itinerary',
          format: 'markdown',
          content: '**Day 1**\n\nArrive and check in.',
          editable: true,
          exportFormats: ['md'],
        },
      },
    },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolName: 'delete_file', parentMessageId: 'm1' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"path":"/tmp/old-draft.pdf"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
    // No RUN_FINISHED — paused on the HITL approval, same as above. File
    // upload isn't scripted here; the kitchen-sink e2e spec drives that
    // live against the real file-handling attachment pipeline.
  ],
};
