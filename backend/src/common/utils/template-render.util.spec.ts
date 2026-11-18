import { escapeHtml, fillTemplate, renderEmailHtml } from './template-render.util';

describe('template-render.util', () => {
  it('fills known placeholders and blanks unknown ones', () => {
    expect(fillTemplate('Hi {{name}} {{nope}}!', { name: 'Asha' })).toBe('Hi Asha !');
  });

  it('escapes HTML in both the template and the values', () => {
    expect(renderEmailHtml('<b>Hi</b> {{name}}', { name: '<script>x</script>' })).toBe(
      '&lt;b&gt;Hi&lt;/b&gt; &lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('turns newlines into <br>', () => {
    expect(renderEmailHtml('a\nb\r\nc', {})).toBe('a<br>b<br>c');
  });

  it('renders link keys as anchors and drops empty ones', () => {
    expect(renderEmailHtml('Pay: {{payment_link}}', { payment_link: 'https://rzp.io/i/x' }, ['payment_link'])).toBe(
      'Pay: <a href="https://rzp.io/i/x">https://rzp.io/i/x</a>',
    );
    expect(renderEmailHtml('Pay: {{payment_link}}', { payment_link: '' }, ['payment_link'])).toBe('Pay: ');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`a&b"c'`)).toBe('a&amp;b&quot;c&#39;');
  });
});
