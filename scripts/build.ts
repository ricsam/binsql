import path from "node:path";
import { $, Glob } from "bun";

const packageDir = path.join(import.meta.dirname, "..");

type ModuleExtension = "cjs" | "mjs";

const writeJson = async (filePath: string, value: unknown) => {
  await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const buildPackage = async () => {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = await Bun.file(packageJsonPath).json();
  const npmPackageName = packageJson.name;

  console.log(`Building ${npmPackageName}...`);

  await writeJson(path.join(packageDir, "tsconfig.build.json"), {
    compilerOptions: {
      allowJs: true,
      allowSyntheticDefaultImports: true,
      allowImportingTsExtensions: true,
      declaration: true,
      esModuleInterop: true,
      inlineSourceMap: false,
      lib: ["ESNext"],
      listEmittedFiles: false,
      listFiles: false,
      module: "Preserve",
      moduleResolution: "bundler",
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      pretty: true,
      resolveJsonModule: true,
      rootDir: ".",
      skipLibCheck: true,
      strict: true,
      target: "ESNext",
      traceResolution: false,
      verbatimModuleSyntax: true,
    },
    compileOnSave: false,
    exclude: ["node_modules", "dist", "**/*.test.ts"],
    include: ["index.ts", "src/**/*.ts"],
  });

  await writeJson(path.join(packageDir, "tsconfig.types.json"), {
    extends: "./tsconfig.build.json",
    compilerOptions: {
      declaration: true,
      declarationDir: "dist/types",
      emitDeclarationOnly: true,
      outDir: "dist/types",
    },
  });

  await $`rm -rf dist`.cwd(packageDir);

  const runTsc = async (tsconfig: string) => {
    const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p ${tsconfig}`.cwd(packageDir).nothrow();

    if (exitCode !== 0) {
      console.error(stderr.toString());
      console.log(stdout.toString());
      return false;
    }

    const output = stdout.toString().trim();
    if (output.length > 0) {
      console.log(output);
    }
    console.log("Type declarations generated");
    return true;
  };

  const buildFile = async (src: string, relativeDir: string, extension: ModuleExtension) => {
    const result = await Bun.build({
      entrypoints: [src],
      outdir: path.join(packageDir, "dist", extension, relativeDir),
      sourcemap: "external",
      format: extension === "mjs" ? "esm" : "cjs",
      packages: "external",
      external: ["*"],
      naming: `[name].${extension}`,
      target: "node",
      plugins: [
        {
          name: "relative-extension-plugin",
          setup(build) {
            build.onLoad({ filter: /\.tsx?$/, namespace: "file" }, async (args) => {
              let contents = await Bun.file(args.path).text();

              contents = contents.replace(
                /((?:im|ex)port\s[\w{}/*\s,]+from\s["'](?:\.\.?\/)+[^"']+?)(?:\.tsx?)?(?=["'])/gm,
                `$1.${extension}`,
              );
              contents = contents.replace(
                /(import\(["'](?:\.\.?\/)+[^"']+?)(?:\.tsx?)?(?=["'])/gm,
                `$1.${extension}`,
              );

              return {
                contents,
                loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
              };
            });
          },
        },
      ],
    });

    for (const log of result.logs) {
      console.log(`[${log.level}] ${log.message}`);
    }

    return result.success;
  };

  const buildRootIndex = async (extension: ModuleExtension) => {
    return buildFile(path.join(packageDir, "index.ts"), "", extension);
  };

  const buildSrcFiles = async (extension: ModuleExtension) => {
    const tsGlob = new Glob("**/*.ts");
    let allSuccess = true;

    for await (const file of tsGlob.scan({ cwd: path.join(packageDir, "src") })) {
      if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) {
        continue;
      }

      const relativeDir = path.dirname(file);
      const success = await buildFile(path.join(packageDir, "src", file), path.join("src", relativeDir), extension);
      allSuccess &&= success;
    }

    return allSuccess;
  };

  const success = (
    await Promise.all([
      buildRootIndex("mjs"),
      buildRootIndex("cjs"),
      buildSrcFiles("mjs"),
      buildSrcFiles("cjs"),
      runTsc("tsconfig.types.json"),
    ])
  ).every(Boolean);

  if (!success) {
    throw new Error(`Failed to build ${npmPackageName}`);
  }

  for (const [folder, type] of [
    ["dist/cjs", "commonjs"],
    ["dist/mjs", "module"],
  ] as const) {
    await writeJson(path.join(packageDir, folder, "package.json"), {
      name: packageJson.name,
      version: packageJson.version,
      type,
    });
  }

  const publishPackageJson = { ...packageJson };

  delete publishPackageJson.devDependencies;
  delete publishPackageJson.module;
  delete publishPackageJson.type;

  publishPackageJson.main = "./dist/cjs/index.cjs";
  publishPackageJson.module = "./dist/mjs/index.mjs";
  publishPackageJson.types = "./dist/types/index.d.ts";
  publishPackageJson.exports = {
    ".": {
      types: "./dist/types/index.d.ts",
      require: "./dist/cjs/index.cjs",
      import: "./dist/mjs/index.mjs",
    },
  };
  publishPackageJson.publishConfig = {
    access: "public",
  };
  publishPackageJson.files = ["dist", "README.md"];

  await writeJson(packageJsonPath, publishPackageJson);

  console.log(`Finished building ${npmPackageName} v${packageJson.version}`);
};

const main = async () => {
  try {
    await buildPackage();
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
};

await main();
