#!/usr/bin/env python3
"""Build a self-contained Codex skill from one Git commit; no network or packages.

python tools/install-skill.py --dest <skill-directory> [--source-ref HEAD] [--replace | --check]
Existing skills require --replace; a full backup is kept outside the skills folder.
--check reports drift without writing anything. Source bytes always come from Git,
so uncommitted edits and Windows checkout newline conversions cannot enter a build.
"""
import argparse
import datetime as dt
import json
import posixpath
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALIASES = {
    "docs/apple-native.md": "apple-native.md",
    "docs/emulation.md": "emulation.md",
    "docs/08-checklist.md": "fidelity.md",
    "docs/sources.md": "sources.md",
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def build(ref):
    commit = git("rev-parse", "--verify", ref + "^{commit}").decode().strip()
    tracked = git("ls-tree", "-r", "--name-only", commit).decode("utf-8").splitlines()
    selected = [p for p in tracked if p.startswith(("docs/", "platforms/", "reference/", "tokens/", "tools/"))
                or p in ("AGENTS.md", "README.md")]
    source = {p: git("show", commit + ":" + p) for p in selected}
    output = {"references/upstream/" + p: data for p, data in source.items()}

    def rewrite(text, source_path, entry=False):
        def link(match):
            url = match[1]
            if url.startswith("#") or re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
                return match[0]
            path, sep, anchor = url.partition("#")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source_path), path))
            target = ALIASES.get(resolved, "upstream/" + resolved)
            if entry:
                target = "references/" + target
            return "](" + target + (sep + anchor if sep else "") + ")"
        return re.sub(r"\]\(([^)\s]+)\)", link, text)

    entry = source["AGENTS.md"].decode("utf-8").split("\n## Работа с этим репозиторием", 1)[0]
    description = "Создавай и проверяй Liquid Glass, близкий к Apple: native на Apple, прозрачность, blur и реальная линза на web, Windows и Android."
    entry = "---\nname: liquidglass\ndescription: " + json.dumps(description, ensure_ascii=False) + "\n---\n\n" + rewrite(entry, "AGENTS.md", True)
    output["SKILL.md"] = entry.encode("utf-8")
    for path, alias in ALIASES.items():
        if path == "docs/sources.md":
            continue
        output["references/" + alias] = rewrite(source[path].decode("utf-8"), path).encode("utf-8")
    output["references/sources.md"] = (
        "# Источник установленного навыка\n\n"
        f"Снимок [moz9/liquidglass](https://github.com/moz9/liquidglass) из commit [{commit}]"
        f"(https://github.com/moz9/liquidglass/commit/{commit}).\n\n"
        f"В `upstream/` сохранены {len(source)} файлов из одного commit, без локальных зависимостей, "
        "временных файлов и результатов тестов. Это инженерные примеры, не спецификация Apple.\n\n"
        "[Источники и границы проверки](upstream/docs/sources.md). "
        "Сборка навыка воспроизводима через `tools/install-skill.py` из этого commit. "
        "Для новой редакции повтори установку; существующий снимок не обновляется автоматически.\n"
    ).encode("utf-8")
    output["agents/openai.yaml"] = (
        'interface:\n  display_name: "Liquid Glass"\n'
        '  short_description: "Liquid Glass: native, оптика и проверка"\n'
        '  default_prompt: "Используй $liquidglass: выбери renderer по платформе, проверь прозрачность, blur и линзу на живом фоне, сохрани чёткий foreground и доступность."\n'
    ).encode("utf-8")
    # Migrate the older local snapshot-only helper without dropping its filename.
    # Both dry runs and updates now rebuild the entrypoint/references as well.
    output["sync-upstream.ps1"] = (
        "param(\n  [Parameter(Mandatory)] [string]$Repo,\n  [switch]$Apply\n)\n"
        "$ErrorActionPreference = 'Stop'\n"
        "$installer = Join-Path $Repo 'tools/install-skill.py'\n"
        "if (-not (Test-Path -LiteralPath $installer)) { throw 'Use a clone containing tools/install-skill.py' }\n"
        "$taskArgs = @('-X', 'utf8', $installer, '--dest', $PSScriptRoot)\n"
        "if ($Apply) { $taskArgs += '--replace' } else { $taskArgs += '--check' }\n"
        "& python @taskArgs\n"
        "if ($LASTEXITCODE -ne 0) { throw 'Skill sync differs or failed; inspect the output above' }\n"
    ).encode("utf-8")
    # Validate copied source references and wrapper paths before any installation.
    for path, data in output.items():
        if not path.endswith(".md") or path.startswith("references/upstream/"):
            continue
        for url in re.findall(r"\]\(([^)\s]+)\)", data.decode("utf-8")):
            if url.startswith("#") or re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), url.split("#")[0]))
            if target not in output:
                raise ValueError(f"Broken generated reference: {path}: {url}")
    return commit, output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", required=True, type=Path)
    parser.add_argument("--source-ref", default="HEAD")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--replace", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    commit, files = build(args.source_ref)
    dest = args.dest.resolve()
    # Never replace a repository or a broad directory on a mistyped destination.
    if dest == ROOT or dest in ROOT.parents or (dest / ".git").exists():
        parser.error("Destination must be a dedicated skill folder, outside the repository")
    if dest.is_symlink() or (hasattr(dest, "is_junction") and dest.is_junction()):
        parser.error("Destination must not be a symlink or junction")
    if args.check:
        different = [p for p, data in files.items() if not (dest / p).is_file() or (dest / p).read_bytes() != data]
        extra = sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()
                       and p.relative_to(dest).as_posix() not in files) if dest.is_dir() else []
        print(json.dumps({"commit": commit, "different": different, "extra": extra}, ensure_ascii=False))
        return int(bool(different or extra))
    if dest.exists():
        if not args.replace:
            parser.error("Destination exists: use --check or --replace (with backup)")
        if not (dest / "SKILL.md").is_file() or not (dest / "references").is_dir():
            parser.error("Existing destination is not a recognized skill folder")
        expected = set(files)
        extra = [p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()
                 and p.relative_to(dest).as_posix() not in expected]
        if extra:
            parser.error("Unexpected files in existing skill; preserve them before replacement: " + ", ".join(extra))
        backup = dest.parent.parent / "backups" / "liquidglass" / dt.datetime.now().strftime("sync-%Y%m%d-%H%M%S-%f") / dest.name
        shutil.copytree(dest, backup)
        print("Backup:", backup)
    for path, data in files.items():
        target = dest / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    assert all((dest / p).read_bytes() == data for p, data in files.items())
    print(f"Installed {len(files)} files from {commit}: {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
