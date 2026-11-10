/**
 * AMIVARA ROSE design-token generator.
 *
 * Reads  design/brand/tokens.json (W3C DTCG format)
 * Writes apps/mobile/lib/theme/rose_tokens.g.dart   (Flutter Material 3)
 *        apps/web/src/app/rose-tokens.css            (Next.js public web)
 *        apps/admin/src/app/rose-tokens.css          (Next.js admin)
 *
 * Usage:
 *   node scripts/generate-tokens.ts           # write outputs
 *   node scripts/generate-tokens.ts --check   # exit 1 if outputs are stale (CI)
 *
 * Runs on Node >= 22.18 / 24 with native type stripping, so no build step or
 * dependencies are needed. Keep this file to erasable TypeScript syntax only.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface Dimension {
  value: number;
  unit: string;
}

interface TypographyValue {
  fontFamily: string[];
  fontSize: Dimension;
  lineHeight: number;
  fontWeight: number;
  letterSpacing: Dimension;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'design/brand/tokens.json');
const HEADER_NOTE =
  'GENERATED FILE. Do not edit by hand. Source: design/brand/tokens.json. Regenerate with `pnpm tokens`.';

const tokens = JSON.parse(readFileSync(SOURCE, 'utf8')) as JsonObject;

// ───────────────────────── helpers ─────────────────────────

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lookup(path: string): JsonObject {
  let node: Json | undefined = tokens;
  for (const key of path.split('.')) {
    node = isObject(node) ? node[key] : undefined;
  }
  if (!isObject(node) || !('$value' in node)) {
    throw new Error(`Token reference {${path}} does not resolve to a token`);
  }
  return node;
}

/** Resolves {alias} references recursively, inside strings, arrays and objects. */
function resolveValue(value: Json, seen: string[] = []): Json {
  if (typeof value === 'string') {
    const match = /^\{([^}]+)\}$/.exec(value);
    if (!match) return value;
    const ref = match[1];
    if (seen.includes(ref)) throw new Error(`Circular token reference: ${[...seen, ref].join(' -> ')}`);
    return resolveValue(lookup(ref).$value as Json, [...seen, ref]);
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, seen));
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, seen);
    return out;
  }
  return value;
}

/** Walks a token group and returns [pathSegments, resolvedValue] for each token. */
function collect(group: JsonObject, prefix: string[] = []): Array<[string[], Json]> {
  const out: Array<[string[], Json]> = [];
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith('$') || !isObject(node)) continue;
    if ('$value' in node) out.push([[...prefix, key], resolveValue(node.$value as Json)]);
    else out.push(...collect(node, [...prefix, key]));
  }
  return out;
}

function group(path: string): JsonObject {
  let node: Json | undefined = tokens;
  for (const key of path.split('.')) node = isObject(node) ? node[key] : undefined;
  if (!isObject(node)) throw new Error(`Token group ${path} not found`);
  return node;
}

function camel(parts: string[]): string {
  const words = parts.flatMap((p) => p.split(/[-_\s]+/)).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

function kebab(parts: string[]): string {
  return parts.map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()).join('-');
}

/** CSS generic families and web-only faces have no meaning in Flutter. */
const CSS_ONLY_FAMILIES = /^(serif|sans-serif|system-ui|monospace|Georgia)$/;

function dartFallbacks(families: string[]): string {
  return families
    .filter((f) => !CSS_ONLY_FAMILIES.test(f))
    .map((f) => `'${f}'`)
    .join(', ');
}

function dartIdent(parts: string[]): string {
  const name = camel(parts);
  return /^[0-9]/.test(name) ? `s${name}` : name;
}

function hexToDart(hex: string): string {
  const clean = hex.replace('#', '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(clean)) throw new Error(`Unsupported colour value: ${hex}`);
  return `Color(0xFF${clean})`;
}

function num(n: number): string {
  // Dart and CSS both accept plain decimals; trim float noise.
  return String(Number(n.toFixed(6)));
}

function dartDouble(n: number): string {
  const s = num(n);
  return s.includes('.') ? s : `${s}.0`;
}

function asDimension(v: Json): Dimension {
  if (!isObject(v) || typeof v.value !== 'number' || typeof v.unit !== 'string') {
    throw new Error(`Expected a dimension, got ${JSON.stringify(v)}`);
  }
  return { value: v.value, unit: v.unit };
}

function cssFontStack(families: Json): string {
  if (!Array.isArray(families)) throw new Error('fontFamily must be an array');
  return families
    .map((f) => String(f))
    .map((f) => (/^(serif|sans-serif|system-ui|monospace)$/.test(f) ? f : `"${f}"`))
    .join(', ');
}

// ───────────────────────── data ─────────────────────────

const SCHEME_ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'tertiary',
  'onTertiary',
  'surface',
  'onSurface',
  'surfaceContainer',
  'onSurfaceVariant',
  'outline',
  'error',
  'onError',
] as const;

const colorTokens = [
  ...collect(group('color.core')).map(([p, v]) => [p, v] as [string[], Json]),
  ...collect(group('color.palette')).map(([p, v]) => [p, v] as [string[], Json]),
  ...collect(group('color.status')).map(([p, v]) => [['status', ...p], v] as [string[], Json]),
  ...collect(group('color.brand')).map(([p, v]) => [['brand', ...p], v] as [string[], Json]),
];

function scheme(mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of SCHEME_ROLES) {
    const v = resolveValue(lookup(`color.scheme.${mode}.${role}`).$value as Json);
    if (typeof v !== 'string') throw new Error(`color.scheme.${mode}.${role} is not a colour`);
    out[role] = v;
  }
  return out;
}

const light = scheme('light');
const dark = scheme('dark');
const spacing = collect(group('spacing'));
const radius = collect(group('radius'));
const durations = collect(group('motion.duration'));
const easings = collect(group('motion.easing'));
const fontFamilies = collect(group('font.family'));
const typography = collect(group('typography')).map(([p, v]) => [p, v as unknown as TypographyValue] as const);

// ───────────────────────── Dart ─────────────────────────

function renderDart(): string {
  const L: string[] = [];
  L.push(`// ${HEADER_NOTE}`);
  L.push('// ignore_for_file: public_member_api_docs');
  L.push('');
  L.push("import 'package:flutter/material.dart';");
  L.push('');

  L.push('/// Raw AMIVARA ROSE colours. Prefer [RoseSchemes] roles in widgets.');
  L.push('abstract final class RoseColors {');
  for (const [path, value] of colorTokens) {
    L.push(`  static const Color ${dartIdent(path)} = ${hexToDart(String(value))};`);
  }
  L.push('}');
  L.push('');

  L.push('/// Material 3 colour schemes. Dynamic colour (Material You) is deliberately not used.');
  L.push('abstract final class RoseSchemes {');
  for (const [name, roles, brightness] of [
    ['light', light, 'Brightness.light'],
    ['dark', dark, 'Brightness.dark'],
  ] as const) {
    L.push(`  static const ColorScheme ${name} = ColorScheme(`);
    L.push(`    brightness: ${brightness},`);
    for (const role of SCHEME_ROLES) L.push(`    ${role}: ${hexToDart(roles[role])},`);
    L.push('  );');
  }
  L.push('}');
  L.push('');

  L.push('/// Spacing scale in logical pixels (dp), 4dp grid.');
  L.push('abstract final class RoseSpacing {');
  for (const [path, value] of spacing) {
    L.push(`  static const double ${dartIdent(path)} = ${dartDouble(asDimension(value).value)};`);
  }
  L.push('}');
  L.push('');

  L.push('/// Corner radii in logical pixels (dp).');
  L.push('abstract final class RoseRadius {');
  for (const [path, value] of radius) {
    L.push(`  static const double ${dartIdent(path)} = ${dartDouble(asDimension(value).value)};`);
  }
  L.push('}');
  L.push('');

  L.push('/// Motion durations and easing curves.');
  L.push('abstract final class RoseMotion {');
  for (const [path, value] of durations) {
    L.push(`  static const Duration ${dartIdent(path)} = Duration(milliseconds: ${asDimension(value).value});`);
  }
  for (const [path, value] of easings) {
    if (!Array.isArray(value) || value.length !== 4) throw new Error(`Easing ${path.join('.')} must have 4 numbers`);
    L.push(`  static const Cubic ${dartIdent(path)} = Cubic(${value.map((n) => dartDouble(Number(n))).join(', ')});`);
  }
  L.push('}');
  L.push('');

  L.push('/// Font families. The first entry is the brand face; the rest are fallbacks.');
  L.push('abstract final class RoseFonts {');
  for (const [path, value] of fontFamilies) {
    const list = (value as Json[]).map((f) => String(f));
    L.push(`  static const String ${dartIdent(path)} = '${list[0]}';`);
    L.push(
      `  static const List<String> ${dartIdent([...path, 'fallback'])} = <String>[${dartFallbacks(list.slice(1))}];`,
    );
  }
  L.push('}');
  L.push('');

  L.push('/// Material 3 type roles. letterSpacing tokens are in em and are converted to dp here.');
  L.push('abstract final class RoseType {');
  for (const [path, t] of typography) {
    const family = t.fontFamily;
    const size = asDimension(t.fontSize as unknown as Json).value;
    const tracking = asDimension(t.letterSpacing as unknown as Json).value * size;
    L.push(`  static const TextStyle ${dartIdent(path)} = TextStyle(`);
    L.push(`    fontFamily: '${family[0]}',`);
    L.push(`    fontFamilyFallback: <String>[${dartFallbacks(family.slice(1))}],`);
    L.push(`    fontSize: ${dartDouble(size)},`);
    L.push(`    height: ${dartDouble(t.lineHeight)},`);
    L.push(`    fontWeight: FontWeight.w${t.fontWeight},`);
    L.push(`    letterSpacing: ${dartDouble(tracking)},`);
    L.push('  );');
  }
  L.push('}');
  L.push('');
  return L.join('\n');
}

// ───────────────────────── CSS ─────────────────────────

function cssSchemeVars(roles: Record<string, string>, indent: string): string[] {
  const out = SCHEME_ROLES.map((role) => `${indent}--am-${kebab([role])}: ${roles[role]};`);
  // Short semantic aliases used across the web apps (see AMIVARA_ROSE.md §7.2).
  out.push(`${indent}--am-bg: ${roles.surface};`);
  out.push(`${indent}--am-text: ${roles.onSurface};`);
  out.push(`${indent}--am-text-muted: ${roles.onSurfaceVariant};`);
  out.push(`${indent}--am-line: ${roles.outline};`);
  out.push(`${indent}--am-accent-text: ${roles.tertiary};`);
  return out;
}

function renderCss(): string {
  const L: string[] = [];
  L.push(`/* ${HEADER_NOTE} */`);
  L.push('');
  L.push(':root {');
  L.push('  color-scheme: light dark;');
  L.push('');
  L.push('  /* Raw palette */');
  for (const [path, value] of colorTokens) L.push(`  --am-color-${kebab(path)}: ${String(value)};`);
  L.push(`  --am-accent: ${String(resolveValue('{color.core.champagne-gold}'))};`);
  L.push('');
  L.push('  /* Material 3 roles: light */');
  L.push(...cssSchemeVars(light, '  '));
  L.push('');
  L.push('  /* Typography */');
  for (const [path, value] of fontFamilies) L.push(`  --am-font-${kebab(path)}: ${cssFontStack(value)};`);
  for (const [path, t] of typography) {
    const name = kebab(path);
    const size = asDimension(t.fontSize as unknown as Json);
    L.push(`  --am-type-${name}-size: ${num(size.value)}${size.unit};`);
    L.push(`  --am-type-${name}-line-height: ${num(t.lineHeight)};`);
    L.push(`  --am-type-${name}-weight: ${t.fontWeight};`);
    L.push(`  --am-type-${name}-tracking: ${num(asDimension(t.letterSpacing as unknown as Json).value)}em;`);
  }
  L.push('');
  L.push('  /* Spacing, radius, motion */');
  for (const [path, value] of spacing) {
    const d = asDimension(value);
    L.push(`  --am-space-${kebab(path)}: ${num(d.value)}${d.unit};`);
  }
  for (const [path, value] of radius) {
    const d = asDimension(value);
    L.push(`  --am-radius-${kebab(path)}: ${num(d.value)}${d.unit};`);
  }
  for (const [path, value] of durations) {
    const d = asDimension(value);
    L.push(`  --am-duration-${kebab(path)}: ${num(d.value)}${d.unit};`);
  }
  for (const [path, value] of easings) {
    L.push(`  --am-easing-${kebab(path)}: cubic-bezier(${(value as Json[]).map((n) => num(Number(n))).join(', ')});`);
  }
  L.push('}');
  L.push('');
  L.push('@media (prefers-color-scheme: dark) {');
  L.push('  :root:not([data-theme="light"]) {');
  L.push(...cssSchemeVars(dark, '    '));
  L.push('  }');
  L.push('}');
  L.push('');
  L.push(':root[data-theme="dark"] {');
  L.push(...cssSchemeVars(dark, '  '));
  L.push('}');
  L.push('');
  L.push(':root[data-theme="light"] {');
  L.push('  color-scheme: light;');
  L.push('}');
  L.push('');
  return L.join('\n');
}

// ───────────────────────── write / check ─────────────────────────

const outputs: Array<[string, string]> = [
  ['apps/mobile/lib/theme/rose_tokens.g.dart', renderDart()],
  ['apps/web/src/app/rose-tokens.css', renderCss()],
  ['apps/admin/src/app/rose-tokens.css', renderCss()],
];

const check = process.argv.includes('--check');
const normalise = (s: string): string => s.replace(/\r\n/g, '\n');
let stale = 0;

for (const [rel, content] of outputs) {
  const file = join(ROOT, rel);
  const current = existsSync(file) ? normalise(readFileSync(file, 'utf8')) : null;
  if (check) {
    if (current !== content) {
      stale++;
      console.error(`✗ ${rel} is out of date with design/brand/tokens.json`);
    } else {
      console.log(`✓ ${rel}`);
    }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    console.log(`wrote ${rel}`);
  }
}

if (stale > 0) {
  console.error(`\n${stale} generated file(s) are stale. Run \`pnpm tokens\` and commit the result.`);
  process.exit(1);
}
