// Media layer: hand Base64 images to the `img-ingest` static binary over stdin.
//
// The binary (SPEC §5) validates magic bytes, strips metadata, resizes and
// atomically writes images into an output directory, then reports strict JSON
// on stdout. Base64 payloads are ONLY ever written to the child's stdin —
// never to argv, logs, or error messages.

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ImageInput, IngestedImage } from "../types.js";

export interface ImgIngestOptions {
  binPath: string;
  outDir: string;
  maxBytes?: number;
  maxDim?: number;
}

/** Path of the bundled img-ingest binary for a harness installation root. */
export function findImgIngestBin(harnessRoot: string): string {
  return join(harnessRoot, "bin", "img-ingest");
}

/** Redact anything that looks like a long Base64 run so errors stay log-safe. */
function redactBase64(text: string): string {
  return text.replace(/[A-Za-z0-9+/=]{120,}/g, "[redacted]");
}

function summarizeStderr(stderr: string): string {
  const cleaned = redactBase64(stderr).trim();
  return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned;
}

function parseIngestStdout(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("img-ingest produced no output on stdout");
  }
  // Single image: one JSON object. Multiple: JSON array or JSONL.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fall through to JSONL parsing.
  }
  const entries: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      throw new Error(
        `img-ingest returned unparseable stdout line: ${redactBase64(t).slice(0, 200)}`,
      );
    }
  }
  return entries;
}

/**
 * Ingest one or more Base64 images through the img-ingest binary.
 *
 * Protocol: a single image is sent as the raw Base64 string on stdin;
 * multiple images are sent as JSONL (`{"id","base64","label"}` per line).
 * Throws on non-zero exit, `ok:false` entries, or malformed output. Error
 * messages contain only a stderr summary — never image data.
 */
export function ingestImages(
  opts: ImgIngestOptions,
  images: ImageInput[],
): Promise<IngestedImage[]> {
  if (images.length === 0) return Promise.resolve([]);

  const args: string[] = ["--out-dir", opts.outDir];
  if (opts.maxBytes !== undefined) args.push("--max-bytes", String(opts.maxBytes));
  if (opts.maxDim !== undefined) args.push("--max-dim", String(opts.maxDim));

  const stdinPayload =
    images.length === 1
      ? images[0].base64
      : images
          .map((img) =>
            JSON.stringify({
              id: img.id ?? img.label,
              base64: img.base64,
              label: img.label,
            }),
          )
          .join("\n") + "\n";

  return new Promise<IngestedImage[]>((resolve, reject) => {
    const child = spawn(opts.binPath, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `failed to launch img-ingest (${opts.binPath}): ${err.message}. ` +
            "Build it with scripts/build-img-ingest.sh.",
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `img-ingest exited with code ${code ?? "null"}: ${summarizeStderr(stderr)}`,
          ),
        );
        return;
      }
      try {
        const entries = parseIngestStdout(stdout);
        const results: IngestedImage[] = entries.map((entry, i) => {
          const raw = (entry ?? {}) as Record<string, unknown>;
          if (raw.ok === false) {
            throw new Error(
              `img-ingest rejected image ${i + 1}: ${redactBase64(
                String(raw.error ?? raw.message ?? "unknown error"),
              ).slice(0, 300)}`,
            );
          }
          if (typeof raw.path !== "string" || !raw.path) {
            throw new Error(`img-ingest result ${i + 1} is missing a path`);
          }
          const result = raw as unknown as IngestedImage;
          // Preserve the caller's label when the binary does not echo one.
          if (result.label === undefined && images[i]?.label !== undefined) {
            result.label = images[i].label;
          }
          return result;
        });
        resolve(results);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    child.stdin.on("error", () => {
      // EPIPE etc. — the close handler reports the real failure.
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
