import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Smaller answers gain too little to be worth compressing. */
const MIN_BYTES = 1024;

/**
 * The answers the app loads while picking, often several ahead of a tap: the questions, the picks, "Something like…"
 * and the profile's lists. They hold no secrets, so compressing them can't leak one (BREACH). Settings, setup and the
 * sign-ins never are.
 */
export const compressible = (url: string) => /^\/api\/(wizard\/\w+|recommendations|like|hidden)(\?|$)/.test(url);

/** Compresses the picking answers for browsers that accept it: brotli (offered over HTTPS), else gzip. */
export function compressAnswers(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' || payload.length < MIN_BYTES || !compressible(req.url)) return payload;
    if (!String(reply.getHeader('content-type') ?? '').startsWith('application/json')) return payload;
    reply.header('vary', 'accept-encoding');
    const accepts = String(req.headers['accept-encoding'] ?? '');
    // Quality 4 keeps most of brotli's gain at a fraction of its default cost.
    if (/\bbr\b/.test(accepts)) {
      reply.header('content-encoding', 'br');
      return brotli(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
    }
    if (/\bgzip\b/.test(accepts)) {
      reply.header('content-encoding', 'gzip');
      return gzipped(payload, { level: 6 });
    }
    return payload;
  });
}
