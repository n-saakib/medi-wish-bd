import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../messages/en.json';
import { UserAccessPanel } from '../src/app/UserAccessPanel';

describe('UserAccessPanel', () => {
  it('renders the identifier login contract and stable accessible feedback regions', () => {
    const markup = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop -- React 19 provider props require typed children here.
      createElement(
        NextIntlClientProvider,
        { locale: 'en', messages, children: createElement(UserAccessPanel) },
      ),
    );

    expect(markup).toContain('Username, mobile, or email');
    expect(markup).toContain('id="login-identifier"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('Basic');
    expect(markup).not.toContain('localStorage');
  });
});
