/**
 * Browser half of dsh-celebrate.
 *
 * This module registers both frame-wide layers of the bundle:
 * 1. `dsh-celebrate.confetti` — listens on the bundle's Server-Sent-Events
 *    channel and runs the confetti cannon (enlarged positive emoji, including
 *    🐋 and 🐳, with a high apex and a gravity fall out of the bottom edge);
 * 2. `dsh-celebrate.disco` — the mirror-tile disco ball layer. It is part of
 *    this client bundle, but it only shows while the host-only
 *    `dsh-celebrate/disco` component is enabled: that Loader row owns a small
 *    availability route which this module asks before every burst.
 *
 * Every burst dispatches `dsh-celebrate:burst` on `window`, and the pool
 * dispatches `dsh-celebrate:settled` once the last emoji is gone, which drives
 * the lamp's eased retract.
 */

window.__ModuleLoader__.load({
  id: 'dsh-celebrate',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Document-relative form of the Host route (see dsh-client-hmr for precedent). */
    const EVENTS_ROUTE = '/dsh-celebrate/events'.slice(1);
    const DEFAULT_EMOJI_COUNT = 60;
    const MAX_EMOJI = 280;

    /**
     * Positive / festive emoji only: no sad, angry, hurt or otherwise negative
     * sentiment. Whales are handled separately and are always present.
     */
    const EMOJI = Object.freeze([
      '🎉', '🎊', '🎈', '🎁', '✨', '🌟', '⭐', '🥳',
      '😄', '😁', '🤩', '🥰', '💖', '💛', '💚', '💙',
      '💜', '🌈', '🍰', '🎂', '🍭', '🍬', '🌸', '🌼',
      '🌻', '🦋', '☀️', '🐋', '🐳',
    ]);
    const WHALE_EMOJI = Object.freeze(['🐋', '🐳']);

    const CSS = `
.dsc-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;}
.dsc-p{position:absolute;left:0;top:0;display:block;line-height:1;will-change:transform,opacity;user-select:none;transform-origin:50% 50%;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif;}
`;

    /** Pick the emoji for one particle; the first two are always the whales. */
    function pickEmoji(index) {
      if (index < WHALE_EMOJI.length) return WHALE_EMOJI[index];
      return EMOJI[Math.floor(Math.random() * EMOJI.length)];
    }

    /**
     * Build one confetti particle. The launch point sits just below the bottom
     * edge; the apex is high (often near the top of the viewport), and the
     * particle keeps falling until it has left the bottom of the screen again,
     * so nothing ever sticks to the bottom edge.
     */
    function makeParticle(id, index, now) {
      const width = Math.max(320, window.innerWidth);
      const height = Math.max(320, window.innerHeight);
      const whale = index < WHALE_EMOJI.length;
      const base = Math.min(108, Math.max(54, Math.round(height * 0.074)));
      const size = base * (whale ? 1.16 : 1) * (0.86 + Math.random() * 0.32);
      const x0 = width * (0.5 + (Math.random() - 0.5) * (whale ? 0.12 : 0.34));
      const y0 = height + size * 1.2;
      // Apex time and apex height shape the parabola. The apex sits between the
      // middle and the very top of the viewport, so the burst visibly shoots up.
      const tUp = 1.35 + Math.random() * 0.85;
      const peak = height * (0.62 + Math.random() * 0.38) + 40;
      const g = (2 * peak) / (tUp * tUp);
      const vy = -g * tUp;
      // At 2 * tUp the particle is back below its launch point; the extra 0.15 s
      // keeps it moving until it is fully out of the viewport.
      const ttl = tUp * 2 + 0.15;
      return {
        id,
        emoji: pickEmoji(index),
        size,
        x0,
        y0,
        // A gentle outward fan from the centre, kept small so emoji stay on screen.
        vx: (x0 - width * 0.5) * (0.18 + Math.random() * 0.22),
        vy,
        g,
        ttl,
        minX: size * 0.2,
        maxX: width - size * 0.9,
        rot0: Math.random() * 360,
        spin: (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 170),
        start: now,
      };
    }

    /** Parse `data:` lines out of an SSE stream read through the shell transport. */
    async function readTransportEvents(fetch, route, signal, receive) {
      const response = await fetch(route, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`dsh-celebrate: ${route} answered ${String(response.status)}`);
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) receive(line.slice(5).trimStart());
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    }
    function ConfettiLayer() {
      const [particles, setParticles] = React.useState([]);
      const store = React.useRef({
        live: new Map(),
        els: new Map(),
        raf: 0,
        hadBurst: false,
        nextId: 0,
      });

      React.useEffect(() => {
        const st = store.current;
        let eventSource = null;
        let controller = null;

        const tick = (now) => {
          st.raf = 0;
          const dead = [];
          for (const [id, p] of st.live) {
            const t = (now - p.start) / 1000;
            if (t >= p.ttl) {
              dead.push(id);
              continue;
            }
            const y = p.y0 + p.vy * t + 0.5 * p.g * t * t;
            let x = p.x0 + p.vx * t;
            if (x < p.minX) x = p.minX;
            else if (x > p.maxX) x = p.maxX;
            const rot = p.rot0 + p.spin * t;
            const el = st.els.get(id);
            if (el) {
              el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg)`;
            }
          }
          if (dead.length > 0) {
            for (const id of dead) st.live.delete(id);
            setParticles((prev) => prev.filter((p) => st.live.has(p.id)));
          }
          if (st.live.size > 0) {
            st.raf = requestAnimationFrame(tick);
          } else if (st.hadBurst) {
            st.hadBurst = false;
            window.dispatchEvent(new CustomEvent('dsh-celebrate:settled'));
          }
        };

        const ensureLoop = () => {
          if (st.raf === 0) st.raf = requestAnimationFrame(tick);
        };

        const spawn = (frame) => {
          const requested = Number.isFinite(frame.emojiCount)
            ? Math.max(1, Math.min(140, Math.round(frame.emojiCount)))
            : DEFAULT_EMOJI_COUNT;
          const room = MAX_EMOJI - st.live.size;
          const count = Math.max(0, Math.min(requested, room));
          const now = performance.now();
          const next = [];
          for (let index = 0; index < count; index += 1) {
            st.nextId += 1;
            const particle = makeParticle(`dsc-${st.nextId}`, index, now);
            st.live.set(particle.id, particle);
            next.push(particle);
          }
          if (next.length > 0) {
            st.hadBurst = true;
            setParticles((prev) => prev.concat(next));
            ensureLoop();
          }
          window.dispatchEvent(
            new CustomEvent('dsh-celebrate:burst', {
              detail: { seq: Number.isFinite(frame.seq) ? frame.seq : 0, count: next.length },
            }),
          );
        };

        const receive = (data) => {
          let frame;
          try {
            frame = JSON.parse(data);
          } catch {
            return;
          }
          if (frame && frame.type === 'celebrate') spawn(frame);
        };

        const transport = globalThis.__DSH_TRANSPORT__;
        const RECONNECT_MS = 2500;
        let stopped = false;
        let reconnectTimer = 0;

        const scheduleReconnect = () => {
          if (stopped) return;
          window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(open, RECONNECT_MS);
        };

        const openEventSource = () => {
          let source;
          try {
            source = new EventSource(EVENTS_ROUTE);
          } catch {
            scheduleReconnect();
            return;
          }
          eventSource = source;
          source.addEventListener('message', (event) => receive(event.data));
          source.addEventListener('error', () => {
            source.close();
            if (eventSource === source) eventSource = null;
            scheduleReconnect();
          });
        };

        const open = () => {
          if (stopped) return;
          if (transport && typeof transport.fetch === 'function') {
            controller = new AbortController();
            const signal = controller.signal;
            readTransportEvents(transport.fetch, EVENTS_ROUTE, signal, receive)
              .catch(() => {})
              .finally(scheduleReconnect);
          } else if (typeof EventSource !== 'undefined') {
            openEventSource();
          }
        };

        open();

        return () => {
          stopped = true;
          window.clearTimeout(reconnectTimer);
          if (controller) controller.abort();
          if (eventSource) eventSource.close();
          if (st.raf !== 0) cancelAnimationFrame(st.raf);
          st.raf = 0;
          st.live.clear();
          st.els.clear();
          st.hadBurst = false;
        };
      }, []);

      const layer = h(
        'div',
        { className: 'dsc-layer', 'aria-hidden': 'true' },
        particles.map((p) =>
          h(
            'span',
            {
              key: p.id,
              className: 'dsc-p',
              style: {
                fontSize: `${p.size.toFixed(1)}px`,
                transform: `translate3d(${p.x0.toFixed(1)}px, ${p.y0.toFixed(1)}px, 0) rotate(${p.rot0.toFixed(1)}deg)`,
              },
              ref: (el) => {
                if (el) store.current.els.set(p.id, el);
                else store.current.els.delete(p.id);
              },
            },
            p.emoji,
          ),
        ),
      );

      return h(React.Fragment, null, h('style', { key: 'dsc-css' }, CSS), layer);
    }

    /** Document-relative availability route owned by the disco sub-plugin row. */
    const DISCO_STATE_ROUTE = 'dsh-celebrate/disco';

    /** True while the host-only disco sub-plugin row is enabled. */
    async function discoAvailable() {
      const transport = globalThis.__DSH_TRANSPORT__;
      const fetcher = transport && typeof transport.fetch === 'function' ? transport.fetch : globalThis.fetch;
      if (typeof fetcher !== 'function') return false;
      try {
        const response = await fetcher(DISCO_STATE_ROUTE, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return false;
        const type = response.headers.get('content-type') ?? '';
        if (!type.includes('application/json')) return false;
        const value = await response.json();
        return value !== null && typeof value === 'object' && value.enabled === true;
      } catch {
        return false;
      }
    }

    /** Flat palette used by the rays and the random ball tiles. */
    const DISCO_COLORS = Object.freeze(['#ff5ea8', '#ffd93d', '#4ade80', '#38bdf8', '#a78bfa', '#fb923c']);
    const RAY_COUNT = 12;
    const RAY_STEP = 360 / RAY_COUNT;
    /** Safety net: retract even if the confetti layer never reports settled. */
    const DISCO_MAX_ON_SCREEN_MS = 12_000;

    /** Twelve static rays; only the fan container rotates. */
    const DISCO_RAYS = Object.freeze(
      Array.from({ length: RAY_COUNT }, (_, index) => ({
        key: `dsc-ray-${index}`,
        background: DISCO_COLORS[index % DISCO_COLORS.length],
        opacity: index % 2 === 0 ? 0.17 : 0.11,
        transform: `rotate(${index * RAY_STEP}deg)`,
      })),
    );

    // ---------------------------------------------------------------------
    // Mirror-tile disco ball (canvas, 3D perspective, 3渲2 / cel shading).
    // Each tile gets its own random colour; the sphere spins around Y in a
    // level (untilted) view, faces are depth-sorted, and lambert light is
    // quantized into three flat bands for a 3D render with a 2D finish.
    // ---------------------------------------------------------------------
    const BALL_SIZE = 120;
    const BALL_CENTER = BALL_SIZE / 2;
    const BALL_RADIUS = 52;
    const BALL_CAMERA = BALL_RADIUS * 3.2;
    /** Level (eye-level) view: the sphere is not tilted at all. */
    const BALL_TILT = 0;
    const BALL_SPIN_MS = 7200;
    const BALL_ROWS = 12;
    const BALL_RAD = Math.PI / 180;
    const TAU = Math.PI * 2;
    /** Perspective silhouette radius of the sphere (slightly larger than R). */
    const BALL_RIM = (BALL_RADIUS * BALL_CAMERA) / Math.sqrt(BALL_CAMERA * BALL_CAMERA - BALL_RADIUS * BALL_RADIUS);
    /** Fixed key light in camera space, from the upper-left-front. */
    const BALL_LIGHT = Object.freeze({ x: -0.45, y: 0.62, z: 0.64 });
    const BALL_PALETTE = Object.freeze([
      '#ff4f9a', '#ff7ab8', '#ffd93d', '#ffe86b', '#4ade80', '#2dd4bf',
      '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#c084fc', '#fb923c',
      '#f97316', '#facc15', '#34d399', '#22d3ee',
    ]);

    /** Build the sphere's UV grid once; every tile keeps its own random colour. */
    function buildBallTiles() {
      const tiles = [];
      for (let row = 0; row < BALL_ROWS; row += 1) {
        const lat0 = -90 + (row * 180) / BALL_ROWS;
        const lat1 = -90 + ((row + 1) * 180) / BALL_ROWS;
        const latMid = (lat0 + lat1) / 2;
        const cols = Math.max(4, Math.round(24 * Math.max(0.08, Math.cos(latMid * BALL_RAD))));
        for (let col = 0; col < cols; col += 1) {
          const color = BALL_PALETTE[Math.floor(Math.random() * BALL_PALETTE.length)];
          tiles.push({
            lat0,
            lat1,
            lon0: (col * 360) / cols,
            lon1: ((col + 1) * 360) / cols,
            rgb: [
              parseInt(color.slice(1, 3), 16),
              parseInt(color.slice(3, 5), 16),
              parseInt(color.slice(5, 7), 16),
            ],
          });
        }
      }
      return Object.freeze(tiles);
    }

    const BALL_TILES = buildBallTiles();

    /** Project one sphere point through the fixed tilt and the current yaw. */
    function projectBallPoint(latDeg, lonDeg, yaw) {
      const la = latDeg * BALL_RAD;
      const lo = lonDeg * BALL_RAD;
      const cosLa = Math.cos(la);
      const x = cosLa * Math.sin(lo);
      const y = Math.sin(la);
      const z = cosLa * Math.cos(lo);
      const ct = Math.cos(BALL_TILT);
      const st = Math.sin(BALL_TILT);
      const y1 = y * ct - z * st;
      const z1 = y * st + z * ct;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const x2 = x * cy + z1 * sy;
      const z2 = -x * sy + z1 * cy;
      const persp = BALL_CAMERA / (BALL_CAMERA - z2 * BALL_RADIUS);
      return {
        x: BALL_CENTER + x2 * BALL_RADIUS * persp,
        y: BALL_CENTER - y1 * BALL_RADIUS * persp,
        z: z2,
        nx: x2,
        ny: y1,
        nz: z2,
      };
    }

    /** Four-point cartoon sparkle. */
    function drawSparkle(ctx, x, y, radius) {
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 4;
        const r = i % 2 === 0 ? radius : radius * 0.26;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    /** Draw one frame of the spinning, cel-shaded mirror-tile ball. */
    function drawBall(ctx, yaw) {
      ctx.clearRect(0, 0, BALL_SIZE, BALL_SIZE);

      // Dark base fills the grout lines and any hairline gaps between tiles.
      ctx.beginPath();
      ctx.arc(BALL_CENTER, BALL_CENTER, BALL_RIM, 0, TAU);
      ctx.fillStyle = '#0b1220';
      ctx.fill();

      const quads = [];
      for (const tile of BALL_TILES) {
        const a = projectBallPoint(tile.lat0, tile.lon0, yaw);
        const b = projectBallPoint(tile.lat0, tile.lon1, yaw);
        const c = projectBallPoint(tile.lat1, tile.lon1, yaw);
        const d = projectBallPoint(tile.lat1, tile.lon0, yaw);
        const center = projectBallPoint((tile.lat0 + tile.lat1) / 2, (tile.lon0 + tile.lon1) / 2, yaw);
        const dot = center.nx * BALL_LIGHT.x + center.ny * BALL_LIGHT.y + center.nz * BALL_LIGHT.z;
        // 3渲2: hard light bands instead of a smooth gradient.
        const factor = dot > 0.32 ? 1 : dot > -0.12 ? 0.8 : 0.62;
        quads.push({
          a,
          b,
          c,
          d,
          z: (a.z + b.z + c.z + d.z) / 4,
          fill: `rgb(${(tile.rgb[0] * factor) | 0},${(tile.rgb[1] * factor) | 0},${(tile.rgb[2] * factor) | 0})`,
        });
      }
      quads.sort((left, right) => left.z - right.z);

      ctx.save();
      ctx.beginPath();
      ctx.arc(BALL_CENTER, BALL_CENTER, BALL_RIM, 0, TAU);
      ctx.clip();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = '#0b1220';
      for (const quad of quads) {
        ctx.beginPath();
        ctx.moveTo(quad.a.x, quad.a.y);
        ctx.lineTo(quad.b.x, quad.b.y);
        ctx.lineTo(quad.c.x, quad.c.y);
        ctx.lineTo(quad.d.x, quad.d.y);
        ctx.closePath();
        ctx.fillStyle = quad.fill;
        ctx.fill();
        ctx.stroke();
      }
      // Flat glints fixed to the key light (they stay put while the ball spins).
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(BALL_CENTER - 20, BALL_CENTER - 22, 18, 11, -0.55, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ffffff';
      drawSparkle(ctx, BALL_CENTER - 20, BALL_CENTER - 23, 10);
      drawSparkle(ctx, BALL_CENTER + 8, BALL_CENTER - 6, 5.5);
      drawSparkle(ctx, BALL_CENTER - 2, BALL_CENTER + 14, 4);
      ctx.restore();

      // Crisp dark rim keeps the cel-shaded silhouette readable on any theme.
      ctx.beginPath();
      ctx.arc(BALL_CENTER, BALL_CENTER, BALL_RIM, 0, TAU);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b1220';
      ctx.stroke();
    }

    const DISCO_CSS = `
.dsc-disco{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:3;}
.dsc-disco__anchor{position:absolute;left:50%;top:0;width:0;height:0;}
.dsc-disco__rays{position:absolute;left:0;top:70px;width:0;height:0;opacity:0;transform:scale(.62);transition:opacity 620ms ease-out,transform 700ms cubic-bezier(.22,1,.36,1);will-change:transform,opacity;}
.dsc-disco[data-state="in"] .dsc-disco__rays{opacity:1;transform:scale(1);}
.dsc-disco[data-state="out"] .dsc-disco__rays{opacity:0;transform:scale(.62);transition:opacity 380ms ease-in,transform 420ms ease-in;}
.dsc-disco__spin{position:absolute;left:0;top:0;width:0;height:0;animation:dsc-disco-spin 22s linear infinite;}
.dsc-disco__ray{position:absolute;left:-36px;top:0;width:72px;height:46vh;transform-origin:50% 0;clip-path:polygon(50% 0,100% 100%,0 100%);}
.dsc-disco__rig{position:absolute;left:-60px;top:0;width:120px;height:0;transform:translateY(-180px);opacity:0;transition:transform 540ms cubic-bezier(.22,1,.36,1),opacity 320ms ease-out;will-change:transform,opacity;}
.dsc-disco[data-state="in"] .dsc-disco__rig{transform:translateY(0);opacity:1;}
.dsc-disco[data-state="out"] .dsc-disco__rig{transform:translateY(-180px);opacity:0;transition:transform 500ms cubic-bezier(.55,.06,.85,.35),opacity 340ms ease-in;}
.dsc-disco__cord{position:absolute;left:50%;top:0;width:3px;height:6px;margin-left:-1.5px;border-radius:2px;background:rgba(148,163,184,.85);}
.dsc-disco__cap{position:absolute;left:50%;top:2px;width:28px;height:8px;margin-left:-14px;border-radius:4px;background:rgba(148,163,184,.95);}
.dsc-disco__ball{position:absolute;left:50%;top:10px;width:120px;height:120px;margin-left:-60px;display:block;}
.dsc-disco[data-state="out"] .dsc-disco__spin{animation-play-state:paused;}
@keyframes dsc-disco-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
`;

    /** The lamp layer; visibility is a data attribute so CSS owns the easing. */
    function DiscoLamp() {
      const [state, setState] = React.useState('out');
      const ballRef = React.useRef(null);

      React.useEffect(() => {
        let timer = 0;
        const show = () => {
          void discoAvailable().then((available) => {
            if (!available) {
              setState('out');
              return;
            }
            window.clearTimeout(timer);
            setState('in');
            timer = window.setTimeout(() => setState('out'), DISCO_MAX_ON_SCREEN_MS);
          });
        };
        const settle = () => {
          window.clearTimeout(timer);
          timer = 0;
          setState('out');
        };
        window.addEventListener('dsh-celebrate:burst', show);
        window.addEventListener('dsh-celebrate:settled', settle);
        return () => {
          window.removeEventListener('dsh-celebrate:burst', show);
          window.removeEventListener('dsh-celebrate:settled', settle);
          window.clearTimeout(timer);
        };
      }, []);

      // Spin only while the lamp is shown; the last frame stays for the retract.
      React.useEffect(() => {
        if (state !== 'in') return undefined;
        const canvas = ballRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(BALL_SIZE * dpr);
        canvas.height = Math.round(BALL_SIZE * dpr);
        canvas.style.width = `${BALL_SIZE}px`;
        canvas.style.height = `${BALL_SIZE}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let raf = 0;
        const started = performance.now();
        const frame = (now) => {
          drawBall(ctx, ((now - started) / BALL_SPIN_MS) * TAU);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
      }, [state]);

      return h(
        React.Fragment,
        null,
        h('style', { key: 'dsc-disco-css' }, DISCO_CSS),
        h(
          'div',
          { className: 'dsc-disco', 'data-state': state, 'aria-hidden': 'true' },
          h(
            'div',
            { className: 'dsc-disco__anchor' },
            h(
              'div',
              { className: 'dsc-disco__rays' },
              h(
                'div',
                { className: 'dsc-disco__spin' },
                DISCO_RAYS.map((ray) =>
                  h('i', {
                    key: ray.key,
                    className: 'dsc-disco__ray',
                    style: { background: ray.background, opacity: ray.opacity, transform: ray.transform },
                  }),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsc-disco__rig' },
              h('div', { className: 'dsc-disco__cord' }),
              h('div', { className: 'dsc-disco__cap' }),
              h('canvas', { ref: ballRef, className: 'dsc-disco__ball' }),
            ),
          ),
        ),
      );
    }


    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => {
          const disposeDisco = ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-celebrate.disco', order: 10 },
            DiscoLamp,
          );
          const disposeConfetti = ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-celebrate.confetti', order: 20 },
            ConfettiLayer,
          );
          return () => {
            disposeConfetti();
            disposeDisco();
          };
        });
      },
    };
  },
});
