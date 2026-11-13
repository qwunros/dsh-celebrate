/**
 * Host half of the dsh-celebrate-disco sub-plugin.
 *
 * The lamp itself is rendered by the parent bundle's client, but this row is a
 * real, independently switchable Loader component. While it is active it owns
 * a small availability route; the client asks that route before showing the
 * lamp, so switching this component off in the Plugin Manager turns the lamp
 * off without touching the confetti cannon.
 *
 * The row is host-only on purpose: its package specifier is a subpath
 * (`dsh-celebrate/disco`), which DSH's client-modules scan does not serve as a
 * client bundle, while the plugin metadata resolver does read its
 * `./disco/locale/*.json` and `./disco/icon` exports.
 */

/** Document-relative availability route read by the parent bundle's client. */
const ROUTE = '/dsh-celebrate/disco';

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(req.method === 'HEAD' ? undefined : '{"enabled":true}');
        },
      });
      return () => dispose();
    }, 'dsh-celebrate-disco: availability route');
  });
}
