import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// Only ciphertext, public routing metadata, and delivery IDs belong in this store.
export class DiskStore {
  constructor(dir) {
    this.dir = dir;
    this.chain = Promise.resolve();
  }
  async get(key) {
    if (!/^[a-z0-9_-]+$/i.test(key)) throw new Error("Invalid state key");
    try {
      return JSON.parse(await readFile(join(this.dir, key + ".json"), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  set(key, value) {
    const run = this.chain.then(async () => {
      if (!/^[a-z0-9_-]+$/i.test(key)) throw new Error("Invalid state key");
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const path = join(this.dir, key + ".json"),
        tmp = path + "." + randomUUID();
      try {
        const file = await open(tmp, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
        finally { await file.close(); }
        await rename(tmp, path);
        const directory = await open(this.dir, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    });
    this.chain = run.catch(() => {});
    return run;
  }
}
