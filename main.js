import fs from "node:fs";
import { pathToFileURL } from "node:url";

// -----------------------------
// Helpers: path get/set
// -----------------------------
// Get value from input by path with support for:
// - Dot notation (a.b.c)
// - Array wildcard segments with [] (e.g., list[].field → pluck field from each item)
// - Numeric index segments with [n] (e.g., list[0].field)
// Behavior:
// - If any wildcard [] is used, the result will be an array (flattened one level per wildcard step).
// - If [n] is used, it selects that index.
// - If a wildcard is used but the current value is not an array, we treat the single value as a 1-length array for convenience.
export function getValueByPath(obj, path) {
  if (path == null || path === "") return undefined;

  const rawParts = String(path).split(".");

  // Parse a segment like "foo[]" or "foo[0]" or just "foo"
  const parseSeg = (seg) => {
    const m = /^([^\[]+)(\[(\d*)\])?$/.exec(seg);
    if (!m) return { key: seg, mode: "prop" };
    const key = m[1];
    const hasBracket = !!m[2];
    if (!hasBracket) return { key, mode: "prop" };
    const idxStr = m[3];
    if (idxStr === undefined || idxStr === "") return { key, mode: "wildcard" };
    return { key, mode: "index", index: Number(idxStr) };
  };

  let current = obj;
  let isArrayFlow = false; // track if we've produced arrays along the way

  for (const seg of rawParts) {
    const { key, mode, index } = parseSeg(seg);

    if (!isArrayFlow) {
      // current is a single value
      if (current == null) return undefined;
      const nextVal = current[key];
      if (mode === "prop") {
        current = nextVal;
      } else if (mode === "index") {
        if (!Array.isArray(nextVal)) return undefined;
        current = nextVal[index];
      } else if (mode === "wildcard") {
        // start array flow
        const arr = Array.isArray(nextVal) ? nextVal : nextVal == null ? [] : [nextVal];
        current = arr.map((it) => it);
        isArrayFlow = true;
      }
    } else {
      // current is an array of values; map over them
      const mapped = [];
      for (const item of current) {
        if (item == null) continue;
        const val = item[key];
        if (mode === "prop") {
          mapped.push(val);
        } else if (mode === "index") {
          if (Array.isArray(val)) {
            mapped.push(val[index]);
          } else {
            // not an array; no value for this item
            mapped.push(undefined);
          }
        } else if (mode === "wildcard") {
          if (Array.isArray(val)) {
            // flatten one level
            for (const v of val) mapped.push(v);
          } else if (val != null) {
            mapped.push(val);
          }
        }
      }
      current = mapped;
    }
  }

  return current;
}

// Set value on target by path with support for [] in any segment.
// - If a segment ends with [] (e.g., emails[]), we ensure an array exists and use index 0
//   as the working object unless the [] is the last segment, in which case values are pushed.
export function setValueByPath(target, path, value) {
  if (value === undefined) return;

  const segments = path.split(".");
  let current = target;

  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i];
    const isArraySeg = raw.endsWith("[]");
    const key = isArraySeg ? raw.slice(0, -2) : raw;
    const isLast = i === segments.length - 1;

    if (isArraySeg) {
      // Ensure array exists
      if (!Array.isArray(current[key])) current[key] = [];

      if (isLast) {
        // Last segment is an array: push or set entire array if value is array
        if (Array.isArray(value)) {
          // If value is an array, replace contents
          current[key] = value.slice();
        } else {
          current[key].push(value);
        }
        return;
      }

      // Work with index 0 object inside the array
      if (!current[key][0] || typeof current[key][0] !== "object") {
        current[key][0] = {};
      }
      current = current[key][0];
    } else {
      if (isLast) {
        current[key] = value;
        return;
      }
      if (current[key] == null || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
  }
}

// -----------------------------
// Transform registry (custom functions)
// -----------------------------
export const transforms = {
  // Convert ISO 3166-1 alpha-2 country code (e.g., "GB") to English country name (e.g., "United Kingdom").
  countryFromISO(code) {
    if (code == null || code === "") return undefined;
    const normalized = String(code).trim().toUpperCase();
    // Try Intl.DisplayNames if available
    try {
      // Some Node versions require a single locale string, others accept array
      const dn = new Intl.DisplayNames ? new Intl.DisplayNames("en", { type: "region" }) : null;
      if (dn) {
        const name = dn.of(normalized);
        if (name && name !== normalized) return name;
      }
    } catch (_) {
      // ignore and fallback
    }

    // Minimal fallback map for common examples; extend as needed
    const fallback = {
      GB: "United Kingdom",
      US: "United States",
      PH: "Philippines",
      CA: "Canada",
      AU: "Australia"
    };
    return fallback[normalized] || normalized; // last resort: return the code itself
  }
};

// Resolve a mapping spec (used for arguments to transforms)
// - Strings are treated as source paths unless they start with '=' indicating a string literal.
// - Wrapper object with {$literal: ...} yields the contained literal value.
// - Non-strings are returned as-is.
export function resolveSpec(input, spec) {
  if (spec == null || spec === "") return undefined;

  // Explicit literal wrapper
  if (
    spec &&
    typeof spec === "object" &&
    !Array.isArray(spec) &&
    Object.prototype.hasOwnProperty.call(spec, "$literal")
  ) {
    return spec.$literal;
  }

  // Non-string literals: boolean, number, object, array
  if (typeof spec !== "string") return spec;

  // String literal prefix '=' (support '==x' to allow leading '=')
  if (spec.startsWith("=")) {
    return spec.startsWith("==") ? spec.slice(1) : spec.slice(1);
  }

  // Otherwise, resolve as path from input
  return getValueByPath(input, spec);
}

// Core transformer
// Mapping direction: mapping keys are TARGET paths; mapping values are SOURCE paths or literals
export function transform(input, mapping) {
  // If the input is a root-level array, apply mapping per item and return an array
  if (Array.isArray(input)) {
    return input.map((item) => transformOne(item, mapping));
  }
  return transformOne(input, mapping);
}

// Internal: transform a single object input
function transformOne(input, mapping) {
  const result = {};

  for (const [targetPath, sourceSpec] of Object.entries(mapping)) {
    // Skip intentionally empty mappings
    if (sourceSpec === "" || sourceSpec === null) continue;

    // Custom transform: { "$transform": "countryFromISO", "$path": "a.b" } or with "$args": [ ... ]
    if (
      sourceSpec &&
      typeof sourceSpec === "object" &&
      !Array.isArray(sourceSpec) &&
      Object.prototype.hasOwnProperty.call(sourceSpec, "$transform")
    ) {
      const fnName = sourceSpec.$transform;
      const fn = transforms[fnName];
      if (typeof fn !== "function") {
        console.warn(`[record-mapper] Unknown transform: ${fnName}`);
        continue;
      }

      let args = [];
      if (Object.prototype.hasOwnProperty.call(sourceSpec, "$args")) {
        const rawArgs = Array.isArray(sourceSpec.$args) ? sourceSpec.$args : [sourceSpec.$args];
        args = rawArgs.map((a) => resolveSpec(input, a));
      } else if (Object.prototype.hasOwnProperty.call(sourceSpec, "$path")) {
        args = [resolveSpec(input, sourceSpec.$path)];
      }

      try {
        const out = fn(...args);
        if (out !== undefined) setValueByPath(result, targetPath, out);
      } catch (e) {
        console.warn(`[record-mapper] Transform ${fnName} failed:`, e?.message || e);
      }
      continue;
    }

    // Support explicit string literals via wrapper { "$literal": "value" }
    if (
      sourceSpec &&
      typeof sourceSpec === "object" &&
      !Array.isArray(sourceSpec) &&
      Object.prototype.hasOwnProperty.call(sourceSpec, "$literal")
    ) {
      setValueByPath(result, targetPath, sourceSpec.$literal);
      continue;
    }

    // If mapping value is a non-string literal (boolean, number, object, array)
    if (typeof sourceSpec !== "string") {
      setValueByPath(result, targetPath, sourceSpec);
      continue;
    }

    // Support string literal prefix syntax: "=text" becomes literal "text".
    // To set a literal starting with '=', use '==text' which becomes '=text'.
    if (sourceSpec.startsWith("=")) {
      const literal = sourceSpec.startsWith("==")
        ? sourceSpec.slice(1) // keep one leading '='
        : sourceSpec.slice(1);
      setValueByPath(result, targetPath, literal);
      continue;
    }

    // Resolve from input
    const value = getValueByPath(input, sourceSpec);
    if (value === undefined) continue; // nothing to set
    setValueByPath(result, targetPath, value);
  }

  return result;
}

// MAIN (CLI entrypoint) — only runs when executed directly, not when imported by tests
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const INPUT_FILE = process.argv[2];
  const MAPPING_FILE = process.argv[3];
  const OUTPUT_FILE = process.argv[4] || "output.json";

  if (!INPUT_FILE || !MAPPING_FILE) {
    console.error("Usage: node main.js <input.json> <mapping.json> <optional: output.json>");
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, "utf8"));

  const output = transform(input, mapping);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Transformation completed → ${OUTPUT_FILE}`);
}

export default {
  getValueByPath,
  setValueByPath,
  resolveSpec,
  transforms,
  transform
};

