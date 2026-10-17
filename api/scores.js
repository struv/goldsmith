import { createScoresApi } from '../server/scores.js';

const scores = createScoresApi();

export const GET = scores;
export const POST = scores;
