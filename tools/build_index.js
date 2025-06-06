#!/usr/bin/env node
/**
 * build_index.js — Pure‑JavaScript compact index builder
 * ======================================================
 *
 * Outputs (repo root):
 *   · sparse_postings.json      – BM25 inverted lists (gap‑encoded)
 *   · dense_vectors_uint8.json  – 128‑dim int‑8 vectors (LSI)
 *   · chunk_meta.json           – id → file/start/end
 *
 * Tailored for JavaScript:
 *   · CamelCase + dot‑path splitting
 *   · Porter stemming, uni + bigram
 *
 * No native addons, no Python: SVD via ml‑matrix (pure JS).
 *
 * Dependencies:
 *   npm i ml-matrix snowball-stemmers minimist pretty-bytes
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import prettyBytes from 'pretty-bytes';
import { Matrix, SVD } from 'ml-matrix';

// ----- CLI & constants -----
const argv = minimist(process.argv.slice(2), { default:{ chunk:750 } });
const CHUNK = Number(argv.chunk);
const ROOT  = argv.root || '.';
const DIMS  = 128;
const VALID_EXT=/\.(jsx?|tsx?|mjs|cjs|json|md|txt|html|css)$/i;
const SKIP=new Set(['node_modules','.git', 'img', '.github', 'dist','coverage','exports','.github', 'lemmings', 'lemmings_all', 'lemmings_ohNo', 'xmas91', 'xmas92', 'holiday93', 'holiday94']);

// ----- Tokeniser -----
const stemmer=Snowball.newStemmer('english');
const stem=w=>stemmer.stem(w);
const splitCamel=s=>s.replace(/([a-z])([A-Z])/g,'$1 $2');
const tokenize=txt=>splitCamel(txt.replace(/\./g,' '))
  .toLowerCase().split(/[^a-z0-9_]+/u).filter(Boolean);

// ----- Quick estimate -----
let totalBytes=0,fileCountEst=0;
async function quick(dir){
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const abs=path.join(dir,e.name);
    if(e.isDirectory()){
      if(!SKIP.has(e.name)) await quick(abs);
    } else if(VALID_EXT.test(e.name)){
      totalBytes += (await fs.stat(abs)).size;
      fileCountEst++;
    }
  }
}
await quick(path.resolve(ROOT));
const tokenEst=Math.round(totalBytes/5);
const chunkEst=Math.round(tokenEst/CHUNK);
const vocabEst=Math.round(tokenEst*0.15);
console.log(`⚡ Est: files ${fileCountEst}, tokens ${tokenEst.toLocaleString()}, chunks ${chunkEst}, vocab ~${vocabEst}`);

// ----- Build data -----
const df=new Map();
const chunks=[];
let fileCt=0,tokens=0;

function rel(p){return path.relative(ROOT,p).split(path.sep).join('/');}

async function scan(dir){
  const entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const e of entries){
    const abs=path.join(dir,e.name);
    if(e.isDirectory()){
      if(!SKIP.has(e.name)) await scan(abs);
    } else if(VALID_EXT.test(e.name)){
      await handle(abs);
      if(++fileCt%50===0) process.stdout.write(`\r📄  ${fileCt} files…`);
    }
  }
}
async function handle(abs){
  const words=tokenize(await fs.readFile(abs,'utf8'));
  for(let off=0; off<words.length; off+=CHUNK){
    const slice=words.slice(off,off+CHUNK);
    const grams=[];
    for(let i=0;i<slice.length;i++){
      const a=stem(slice[i]);
      grams.push(a);
      if(i<slice.length-1) grams.push(a+'_'+stem(slice[i+1]));
    }
    const tf=new Map();
    grams.forEach(t=>tf.set(t,(tf.get(t)||0)+1));
    new Set(grams).forEach(t=>df.set(t,(df.get(t)||0)+1));
    chunks.push({file:abs,start:off,len:grams.length,tf});
    tokens += grams.length;
  }
}

await scan(path.resolve(ROOT));
console.log(`\n📚 Parsed ${fileCt} files → ${chunks.length} chunks`);

// ----- Build inverted & dense -----
const vocab=Array.from(df.keys()).sort();
const vmap=new Map(vocab.map((t,i)=>[t,i]));
const rows=chunks.length, cols=vocab.length;
const avgLen=tokens/rows;

const BM=Matrix.zeros(rows,cols);
const postings=Array.from({length:cols},()=>[]);
const k1=1.5,b=0.75,N=rows;

chunks.forEach((c,r)=>{
  c.tf.forEach((freq,tok)=>{
    const col=vmap.get(tok);
    postings[col].push(r);
    const idf=Math.log((N-df.get(tok)+0.5)/(df.get(tok)+0.5)+1);
    BM.set(r,col, idf*((freq*(k1+1))/(freq+k1*(1-b+b*(c.len/avgLen)))));
  });
  if(r%Math.ceil(rows/10)===0) process.stdout.write(`\r⚙️  BM25 ${(r/rows*100).toFixed(0)}%…`);
});
console.log('\r⚙️  BM25 100%   ');

// ----- SVD -------------
console.log('⚙️  SVD (128‑D, JS)…');
const svd=new SVD(BM,{autoTranspose:true});
const U=svd.leftSingularVectors.subMatrix(0,rows-1,0,DIMS-1);
const S=Matrix.diag(svd.diagonal.slice(0,DIMS));
const dense=U.mmul(S);

// ----- Quantise -------
const SCALE=32;
const qVec=[];
dense.to2DArray().forEach((row,i)=>{
  if(i%Math.ceil(rows/20)===0) process.stdout.write(`\r   quantise ${(i/rows*100).toFixed(0)}%…`);
  qVec.push(row.map(v=>Math.max(0,Math.min(255,Math.round((v+8)*SCALE)))));
});
console.log('\r   quantise 100%   ');

// gap encode
const gapPost=postings.map(list=>{
  list.sort((a,b)=>a-b);
  let prev=0; return list.map(id=>{const g=id-prev; prev=id; return g;});
});

// ----- Write files -----
await fs.writeFile('sparse_postings.json', JSON.stringify({vocab,postings:gapPost})+'\n');
await fs.writeFile('dense_vectors_uint8.json', JSON.stringify({dims:DIMS,scale:SCALE,vectors:qVec})+'\n');
await fs.writeFile('chunk_meta.json', JSON.stringify(chunks.map((c,i)=>({id:i,file:rel(c.file),start:c.start,end:c.start+CHUNK})))+'\n');
console.log('🎉  compact index built (pure JS).');
