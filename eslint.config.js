import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.build/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 規格書第 3 章：只有引擎轉接層可以接觸 Pi Durable。
    files: ["packages/**/*.ts"],
    ignores: ["packages/engine-adapter/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@earendil-works/*"],
              message: "只有 packages/engine-adapter 可以匯入 Pi Durable（規格書第 3 章）。",
            },
          ],
        },
      ],
    },
  },
);
