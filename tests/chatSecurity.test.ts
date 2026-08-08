import { describe, expect, it } from 'vitest';
import { cleanMerchantName } from '../src/chat/service.js';

describe('chat output sanitization', () => {
  it('decodes supported merchant entities exactly once', () => {
    expect(cleanMerchantName('  Cafe &amp; Market &#39;Uptown&#39; &quot;Express&quot;  ')).toBe('Cafe & Market \'Uptown\' "Express"');
    expect(cleanMerchantName('&amp;quot;Example&amp;quot;')).toBe('&quot;Example&quot;');
    expect(cleanMerchantName('&amp;#39;Example&amp;#39;')).toBe('&#39;Example&#39;');
  });
});
