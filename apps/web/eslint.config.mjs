import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
export default [
  { ignores: [".next/**", ".next-dev/**", ".next-test/**", "next-env.d.ts", "tsconfig*.tsbuildinfo"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
