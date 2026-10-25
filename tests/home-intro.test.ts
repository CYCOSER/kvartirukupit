import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(
  new URL('../server/plugins/home-intro.ts', import.meta.url),
  'utf8',
);
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(
  script,
  'The initial scroll reset must be inline, before Nuxt navigation',
);

for (const navigationType of ['navigate', 'reload']) {
  for (const hash of ['', '#collection', '#location', '#process', '#contact']) {
    test(`homepage start: ${navigationType}, ${hash || 'none'}`, () => {
      const reset =
        navigationType === 'reload' || !hash || hash === '#collection';
      const replacements: unknown[][] = [];
      const scrolls: { top: number; left: number; behavior: string }[] = [];
      let onPageShow: (() => void) | undefined;
      const history = {
        state: { existing: true },
        scrollRestoration: 'auto',
        replaceState: (...args: unknown[]) => replacements.push(args),
      };
      runInNewContext(script!, {
        history,
        performance: { getEntriesByType: () => [{ type: navigationType }] },
        location: { hash, pathname: '/', search: '?source=direct' },
        window: {
          scrollTo: (position: (typeof scrolls)[number]) =>
            scrolls.push(position),
          addEventListener: (
            event: string,
            callback: () => void,
            options: { once: boolean },
          ) => {
            assert.equal(event, 'pageshow');
            assert.equal(options.once, true);
            onPageShow = callback;
          },
        },
      });
      assert.equal(replacements.length, reset && hash ? 1 : 0);
      if (reset && hash)
        assert.deepEqual(replacements[0], [
          history.state,
          '',
          '/?source=direct',
        ]);
      if (!reset) {
        assert.equal(history.scrollRestoration, 'auto');
        assert.equal(scrolls.length, 0);
        assert.equal(onPageShow, undefined);
        return;
      }
      assert.equal(history.scrollRestoration, 'manual');
      onPageShow!();
      assert.equal(
        history.scrollRestoration,
        'auto',
        'Later browser navigation keeps its normal restoration',
      );
      assert.equal(scrolls.length, 2);
      for (const position of scrolls) {
        assert.equal(position.top, 0);
        assert.equal(position.left, 0);
        assert.equal(position.behavior, 'instant');
      }
    });
  }
}
