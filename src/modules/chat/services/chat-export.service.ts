import type { Response } from 'express';
import type { MessagesService } from './messages.service.js';

const CSV_COLUMNS = ['id', 'createdAt', 'senderId', 'senderName', 'text', 'status', 'deliveredAt', 'readAt'] as const;

/** RFC 4180 escaping + a guard against spreadsheet formula injection (=, +, -, @). */
const csvCell = (value: unknown): string => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export class ChatExportService {
  constructor(private readonly messages: MessagesService) {}

  /** Writes the export straight to the HTTP response as it streams from MongoDB. */
  async write(conversationId: string, format: 'json' | 'csv', response: Response): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `chat-${conversationId}-${stamp}.${format}`;
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Cache-Control', 'no-store');

    if (format === 'csv') {
      response.type('text/csv; charset=utf-8');
      response.write('﻿'); // BOM so Excel opens UTF-8 (e.g. Nepali text) correctly
      response.write(`${CSV_COLUMNS.join(',')}\r\n`);
      for await (const message of this.messages.streamAll(conversationId)) {
        response.write(`${CSV_COLUMNS.map((column) => csvCell(message[column])).join(',')}\r\n`);
      }
      response.end();
      return;
    }

    response.type('application/json; charset=utf-8');
    response.write(`{"conversationId":${JSON.stringify(conversationId)},"exportedAt":${JSON.stringify(new Date().toISOString())},"messages":[`);
    let first = true;
    for await (const message of this.messages.streamAll(conversationId)) {
      response.write(`${first ? '' : ','}${JSON.stringify(message)}`);
      first = false;
    }
    response.end(']}');
  }
}
