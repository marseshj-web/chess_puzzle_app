/**
 * lichess_db_puzzle.csv → rating-bucket JSON files
 *
 * Usage:
 *   node scripts/parse-csv.cjs [path/to/lichess_db_puzzle.csv]
 *
 * Default CSV path: ../chess_puzzle/lichess_db_puzzle.csv
 * Output: public/data/r<lo>-<hi>.json + public/data/index.json
 *
 * Uses reservoir sampling (Knuth's Algorithm R) to keep MAX_PER_BUCKET
 * puzzles per bucket — giving a random representative sample without
 * loading all 5M+ puzzles into memory.
 *
 * Each puzzle: { id, fen, moves, rating, themes, popularity }
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = process.argv[2]
  || path.join(__dirname, '..', '..', 'chess_puzzle', 'lichess_db_puzzle.csv');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

const BUCKET_SIZE = 400;
const MAX_PER_BUCKET = 10000;

function bucketKey(rating) {
  const lo = Math.floor(rating / BUCKET_SIZE) * BUCKET_SIZE;
  return `r${String(lo).padStart(4, '0')}-${String(lo + BUCKET_SIZE - 1).padStart(4, '0')}`;
}

function splitLine(line) {
  return line.split(',');
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    console.error('Usage: node scripts/parse-csv.cjs [path/to/lichess_db_puzzle.csv]');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Reservoir sampling: keep MAX_PER_BUCKET random puzzles per bucket
  const reservoirs = {};  // key → Puzzle[]
  const seenCounts = {};  // key → number of puzzles seen so far (for sampling)

  function sampleIntoBucket(key, puzzle) {
    if (!reservoirs[key]) {
      reservoirs[key] = [];
      seenCounts[key] = 0;
    }
    seenCounts[key]++;
    const n = seenCounts[key];
    const res = reservoirs[key];

    if (res.length < MAX_PER_BUCKET) {
      res.push(puzzle);
    } else {
      // Replace a random element with probability MAX_PER_BUCKET/n
      const j = Math.floor(Math.random() * n);
      if (j < MAX_PER_BUCKET) res[j] = puzzle;
    }
  }

  let headers = null;
  let total = 0;
  let idxId, idxFen, idxMoves, idxRating, idxPopularity, idxThemes;

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const start = Date.now();

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!headers) {
      headers = splitLine(line);
      idxId = headers.indexOf('PuzzleId');
      idxFen = headers.indexOf('FEN');
      idxMoves = headers.indexOf('Moves');
      idxRating = headers.indexOf('Rating');
      idxPopularity = headers.indexOf('Popularity');
      idxThemes = headers.indexOf('Themes');
      console.log('Columns:', { idxId, idxFen, idxMoves, idxRating, idxPopularity, idxThemes });
      continue;
    }

    const cols = splitLine(line);
    const rating = parseInt(cols[idxRating], 10);
    if (isNaN(rating)) continue;

    const puzzle = {
      id: cols[idxId],
      fen: cols[idxFen],
      moves: cols[idxMoves].trim().split(/\s+/),
      rating,
      themes: cols[idxThemes] ? cols[idxThemes].split(/\s+/).filter(Boolean) : [],
      popularity: parseInt(cols[idxPopularity], 10) || 0,
    };

    if (!puzzle.fen || !puzzle.moves.length) continue;

    sampleIntoBucket(bucketKey(rating), puzzle);
    total++;

    if (total % 500000 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(`\r  ${total.toLocaleString()} puzzles (${elapsed}s)...`);
    }
  }

  process.stdout.write(`\r  ${total.toLocaleString()} puzzles total.                \n`);

  // Write sampled buckets to JSON files
  const index = {};
  const sortedKeys = Object.keys(reservoirs).sort();

  for (const key of sortedKeys) {
    const puzzles = reservoirs[key];
    const outFile = path.join(OUT_DIR, `${key}.json`);
    fs.writeFileSync(outFile, JSON.stringify(puzzles));
    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
    index[key] = {
      count: puzzles.length,
      total: seenCounts[key],
      file: `${key}.json`,
      sizeMB: parseFloat(sizeMB),
    };
    console.log(`  ${key}: ${puzzles.length.toLocaleString()} / ${seenCounts[key].toLocaleString()} → ${sizeMB} MB`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\nDone! ${sortedKeys.length} bucket files in public/data/`);
  console.log(`Total time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
