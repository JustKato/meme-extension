"""Check that Mozilla signing preserved the released payload. Firefox verifies trust."""

import argparse
import hashlib
import io
import subprocess
from pathlib import Path
from zipfile import BadZipFile, ZipFile


JAR_SIGNATURE = {"META-INF/manifest.mf", "META-INF/mozilla.sf", "META-INF/mozilla.rsa"}
COSE_SIGNATURE = {"META-INF/cose.manifest", "META-INF/cose.sig"}


def archive_files(source, label):
    files = {}
    seen = set()
    with ZipFile(source) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            name = entry.orig_filename
            if name != entry.filename or name.casefold() in seen:
                raise ValueError(f"Ambiguous archive path in {label}: {name!r}")
            seen.add(name.casefold())
            with archive.open(entry) as data:
                files[name] = hashlib.file_digest(data, "sha256").digest()
    return files


def verify(unsigned_path, signed_path, source_ref):
    original = archive_files(unsigned_path, unsigned_path.name)
    if "manifest.json" not in original or original.keys() & (JAR_SIGNATURE | COSE_SIGNATURE):
        raise ValueError("Expected an unsigned extension with a root manifest.json")

    if source_ref:
        tree = f"{source_ref}:extension"
        archive = subprocess.check_output(["git", "archive", "--format=zip", "--", tree])
        comparison = archive_files(io.BytesIO(archive), tree)
    else:
        comparison = archive_files(signed_path, signed_path.name)
        signatures = comparison.keys() & (JAR_SIGNATURE | COSE_SIGNATURE)
        if signatures not in (JAR_SIGNATURE, COSE_SIGNATURE, JAR_SIGNATURE | COSE_SIGNATURE):
            raise ValueError("Missing or incomplete Mozilla signature files")
        for name in signatures:
            if comparison.pop(name) == hashlib.sha256(b"").digest():
                raise ValueError(f"Empty signature file: {name}")

    if comparison != original:
        changed = [name for name in comparison.keys() | original.keys()
                   if comparison.get(name) != original.get(name)]
        raise ValueError("Payload differs from the release: " + ", ".join(sorted(changed)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, usage=(
        "%(prog)s UNSIGNED SIGNED | %(prog)s --source-ref REF UNSIGNED"))
    parser.add_argument("--source-ref", metavar="REF", help="compare the unsigned XPI to REF:extension")
    parser.add_argument("unsigned", type=Path)
    parser.add_argument("signed", type=Path, nargs="?")
    args = parser.parse_args()
    if bool(args.source_ref) == bool(args.signed):
        parser.error("Specify either --source-ref REF or a signed XPI")
    try:
        verify(args.unsigned, args.signed, args.source_ref)
    except (OSError, ValueError, BadZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")
