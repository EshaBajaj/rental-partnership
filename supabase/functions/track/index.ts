import { realDeps } from '../_shared/server/real.ts';
import { makeHandler } from './handler.ts';

Deno.serve(makeHandler(realDeps()));
