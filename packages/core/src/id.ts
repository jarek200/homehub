import { ulid } from 'ulid';

/** Time-sortable unique ID (ULID). */
export function createId(): string {
  return ulid();
}
