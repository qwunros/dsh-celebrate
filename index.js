/**
 * Host half of the dsh-celebrate bundle.
 *
 * It owns two things:
 * 1. the model-facing `celebrate` tool, which the agent calls when the user asks
 *    for a celebration ("放个礼炮", "庆祝一下", ...);
 * 2. a tiny Server-Sent-Events channel (`/dsh-celebrate/events`) that forwards
 *    each burst to every connected Web page. The browser half renders the
 *    confetti; the companion disco bundle listens to the same burst on the page.
 *
 * No dependencies beyond the Cordis context: the tool definition is authored as
 * a plain ToolDefinition so a directly linked workspace package can run without
 * installing any @deepseek-ai runtime package.
 */

/** Browser-facing event stream owned by this bundle. */
const EVENTS_ROUTE = '/dsh-celebrate/events';

/** Tool name the model sees. */
const TOOL_NAME = 'celebrate';

/** Default emoji particle count for one burst ("适量"). */
const DEFAULT_EMOJI_COUNT = 60;

/** Keep-alive comment cadence for the SSE channel. */
const KEEP_ALIVE_MS = 20_000;

export const inject = ['tools'];

export function apply(ctx) {
  /** Monotonic burst counter sent to the browser. */
  let seq = 0;
  /** Connected SSE responses. */
  const streams = new Set();

  /** Write one JSON frame to every live stream. */
  const broadcast = (frame) => {
    if (streams.size === 0) return;
    const line = `data: ${JSON.stringify(frame)}\n\n`;
    for (const response of streams) {
      try {
        response.write(line);
      } catch {
        streams.delete(response);
      }
    }
  };

  // The event stream needs the optional Web carrier. Profiles without a Web GUI
  // still register the tool; it simply has no page to animate.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposeRoute = webCtx.webServer.register({
        kind: 'exact',
        path: EVENTS_ROUTE,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          res.write(': dsh-celebrate connected\n\n');
          res.write('retry: 3000\n\n');
          streams.add(res);
          const keepAlive = setInterval(() => {
            try {
              res.write(': ping\n\n');
            } catch {
              /* the close handlers clean up */
            }
          }, KEEP_ALIVE_MS);
          const release = () => {
            clearInterval(keepAlive);
            streams.delete(res);
          };
          req.on('close', release);
          res.on('close', release);
        },
      });
      return () => {
        disposeRoute();
        for (const response of streams) {
          try {
            response.destroy();
          } catch {
            /* already gone */
          }
        }
        streams.clear();
      };
    }, 'dsh-celebrate: browser event stream');
  });

  ctx.effect(
    () =>
      ctx.tools.register({
        name: TOOL_NAME,
        description:
          'Fire the celebration confetti cannon in the DSH Web UI: enlarged positive emoji (including whales 🐋 and 🐳) burst up from the bottom of the screen and fall under gravity, while the companion disco lamp drops in at the top of the screen. ' +
          'Call this whenever the user asks to celebrate or asks for a celebration effect, for example “放个礼炮”, “放礼花”, “来点彩纸”, “撒花”, “庆祝一下”, “庆祝成功”, “恭喜恭喜”, “开香槟”, or “celebrate”, “congrats”, “party”, “confetti”. ' +
          'It is also appropriate when the user is clearly happy about a milestone they just reached. ' +
          'Do not call it for bad news, failures, grief, or unrelated routine successes the user did not ask to celebrate.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              fired: { type: 'boolean' },
              emojiCount: { type: 'integer' },
            },
            required: ['fired', 'emojiCount'],
            additionalProperties: false,
          },
          render: (_args, value) => {
            const count = value && typeof value.emojiCount === 'number' ? value.emojiCount : DEFAULT_EMOJI_COUNT;
            return [
              {
                type: 'text',
                text:
                  value && value.fired
                    ? `🎉 礼炮已发射：${count} 颗彩纸 emoji 正从屏幕底部升起。`
                    : '礼炮没有发射。',
              },
            ];
          },
        },
        execute: async () => {
          seq += 1;
          broadcast({
            type: 'celebrate',
            seq,
            emojiCount: DEFAULT_EMOJI_COUNT,
            at: Date.now(),
          });
          return { fired: true, emojiCount: DEFAULT_EMOJI_COUNT };
        },
        presentCall: () => ({
          card: 'generic',
          title: '放个礼炮',
          kind: 'other',
        }),
      }),
    'dsh-celebrate: celebrate tool',
  );
}
