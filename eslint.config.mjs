import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  {
    // 构建产物与历史备份不参与检查（否则 8000+ 条噪音全部来自 .next.bak）
    ignores: [
      ".next/**",
      ".next.*/**",
      "node_modules/**",
      ".draft/**",
      "**/*.bak_*/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // 该规则把「挂载后读 localStorage / matchMedia 再同步到 state」判为问题。
    // 本站这类写法是刻意的：首帧必须与 SSR 一致，读到真实值后再切换，否则水合报错。
    // 2026-10-23 人工审计过全部 17 处（theme-toggle / use-mobile / typewriter / fav-note /
    // github-counters / question-body / carousel / home-view / practice-view / questions-view /
    // stats-view / cover-hero / app-shell）：监听器与定时器均有 cleanup，无一处泄漏或无限循环。
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
