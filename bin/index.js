#!/usr/bin/env node
require("make-promises-safe");

// Require Node.js Dependencies
const { strictEqual } = require("assert").strict;
const { join } = require("path");
const { promisify } = require("util");
const { existsSync, readFile } = require("fs");

// Require Third-party Dependencies
const { gray, green, bold, yellow, cyan, red } = require("kleur");
const cross = require("cross-spawn");
const inquirer = require("inquirer");

// Require Internal Dependencies
const { parseOutDatedDependencies, taggedString, findPkgKind } = require("../src/utils");
const { update, rollback } = require("../src/npm");
const questions = require("../src/questions.json");

// CONSTANTS
const STDIO = { stdio: "inherit" };
const CWD = process.cwd();

// VARIABLES
const readFileAsync = promisify(readFile);
const gitTemplate = taggedString`"chore(package): update ${"name"} from ${"from"} to ${"to"}"`;

/**
 * @async
 * @func main
 * @returns {Promise<void>}
 */
async function main() {
    console.log(`\n${gray(" > npm outdated --json")}`);
    const { stdout } = cross.sync("npm", ["outdated", "--json"]);
    const outdated = parseOutDatedDependencies(stdout);

    // Read local package.json
    const localPackage = JSON.parse(
        await readFileAsync(join(CWD, "package.json"), { encoding: "utf8" })
    );

    // Define list of packages to update!
    const packageToUpdate = [];
    for (const pkg of outdated) {
        if (pkg.current === pkg.latest) {
            continue;
        }

        const updateTo = pkg.wanted === pkg.current ? pkg.latest : pkg.wanted;
        console.log(`\n${bold(green(pkg.name))} (${yellow(pkg.current)} -> ${cyan(updateTo)})`);
        const { update } = await inquirer.prompt([questions.update_package]);
        if (!update) {
            continue;
        }

        pkg.kind = findPkgKind(localPackage, pkg);
        pkg.updateTo = updateTo;

        if (pkg.wanted !== pkg.latest && pkg.current !== pkg.wanted) {
            const { release } = await inquirer.prompt([{
                type: "list",
                name: "release",
                choices: [
                    { name: `wanted (${yellow(pkg.wanted)})`, value: pkg.wanted },
                    { name: `latest (${yellow(pkg.latest)})`, value: pkg.latest }
                ],
                default: 0
            }]);

            pkg.updateTo = release;
        }

        packageToUpdate.push(pkg);
    }

    // Exit if there is no package to update
    if (packageToUpdate.length === 0) {
        console.log(`\nNo package to update.. ${red("exiting process")}`);
        process.exit(0);
    }

    // Configuration
    console.log(`\n${gray(" > Configuration")}\n`);
    const { runTest, gitCommit } = await inquirer.prompt([
        questions.run_test,
        questions.git_commit
    ]);

    // Verify test and git on the local root/system
    console.log("");
    if (gitCommit) {
        const { signal } = cross.sync("git", ["--version"]);

        strictEqual(signal, null, new Error("git command not found!"));
        console.log("👍 git executable is accessible");
    }

    if (runTest) {
        const scripts = localPackage.scripts || {};
        strictEqual(Reflect.has(scripts, "test"), true, new Error("unable to found npm test script"));
        console.log("👍 npm test script must exist");
    }
    const hasPackageLock = existsSync(join(CWD, "package-lock.json"));

    console.log(`${gray(" > Everything is okay ... Running update in one second.")}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Run updates!
    for (const pkg of packageToUpdate) {
        console.log(`\nupdating ${bold(green(pkg.name))} (${yellow(pkg.current)} -> ${cyan(pkg.updateTo)})`);
        update(pkg, hasPackageLock);

        if (runTest) {
            console.log(" > npm test");
            try {
                const { signal } = cross.sync("npm", ["test"], STDIO);
                strictEqual(signal, null);
            }
            catch (error) {
                console.log(red("An Error occured while executing tests!"));
                console.log("Rollback to previous version!");
                rollback(pkg, hasPackageLock);

                continue;
            }
        }

        if (gitCommit) {
            const commitMsg = gitTemplate({ name: pkg.name, from: pkg.current, to: pkg.updateTo });
            console.log(` > git commit -m ${yellow(commitMsg)}`);

            cross.sync("git", ["add", "package.json"]);
            cross.sync("git", ["commit", "-m", commitMsg]);
        }
    }

    console.log("\nAll packages updated !\n");
}
main().catch(console.error);
