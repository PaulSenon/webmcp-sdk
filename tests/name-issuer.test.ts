import { it, expect } from 'vitest';
import { createNameIssuer } from '../src/name-issuer.js';
it('normalizes invalid characters', () => { expect(createNameIssuer({ prefix: '', maxNameLength: 64 }).issue('self', 'a.b')).toBe('self__a_b'); });
it('truncates the tool-name part', () => { expect(createNameIssuer({ prefix: '', maxNameLength: 8 }).issue('self', 'long')).toBe('self__lo'); });
it('suffixes collisions internally', () => { const i = createNameIssuer({ prefix: '', maxNameLength: 64 }); i.issue('self', 'a.b'); expect(i.issue('self', 'a_b')).toBe('self__a_b_2'); expect(i.issue('self', 'a!b')).toBe('self__a_b_3'); });
it('throws when the source and tool cannot fit', () => { expect(() => createNameIssuer({ prefix: '', maxNameLength: 4 }).issue('self', 'a')).toThrow(RangeError); });
