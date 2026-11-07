"""Render a survey observer report with Matplotlib; no simulation or qualification."""

import argparse
import hashlib
import io
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--name", default="survey")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    raw = args.report.read_bytes()
    report = json.loads(raw)
    if report.get("benchmark") != "production-survey-observer":
        parser.error("Expected a production survey observer report")
    points = report.get("windows", [])
    if not points or any(point.get("ticks", 0) <= 0 for point in points):
        parser.error("Report needs nonempty measured windows")
    plt.rcParams.update({"svg.fonttype": "none", "font.size": 10})
    figure, axes = plt.subplots(4, 1, figsize=(10, 9), sharex=True)
    births = [point["retainedActors"] for point in points]
    panels = [
        ("Whole window (ticks / second)", "#28664e", [
            point["ticksPerSecond"] for point in points
        ]),
        ("Observer (µs / tick)", "#1b699a", [
            point["observationMs"] * 1000 / point["ticks"] for point in points
        ]),
        ("Physics (µs / tick)", "#93631a", [
            point["physicsMs"] * 1000 / point["ticks"] for point in points
        ]),
        ("Checkpoint capture +\nJSON encode (ms / window)", "#80569a", [
            point["checkpointCaptureMs"] + point["checkpointEncodeMs"] for point in points
        ]),
    ]
    for axis, (label, color, values) in zip(axes, panels):
        axis.plot(births, values, color=color, linewidth=1.5, marker=".", markersize=3)
        axis.set_ylabel(label)
        axis.set_ylim(bottom=0)
        axis.set_xlim(left=0)
        axis.grid(True, alpha=0.25)
    axes[-1].set_xlabel("Cumulative retained births")
    environment = report["environment"]
    figure.suptitle(
        "Production survey observer against retained history\n"
        f"{report['simulatedHours']:.3f} simulated hours · "
        f"{environment['node']} / {environment['platform']} · {report['status']}",
        fontsize=13,
    )
    figure.text(
        0.5, 0.015,
        f"{report['regression']['status']} · headless Node timing; "
        "no browser or replay qualification",
        ha="center", fontsize=9,
    )
    figure.tight_layout(rect=(0, 0.035, 1, 0.93))
    output = io.StringIO()
    figure.savefig(output, format="svg", metadata={
        "Date": None,
        "Title": "Production survey observer timing",
        "Description": (
            f"Report SHA-256 {hashlib.sha256(raw).hexdigest()}; agent {args.name}; "
            "performance evidence only"
        ),
    })
    plt.close(figure)
    with args.output.open("w" if args.replace else "x", encoding="utf-8", newline="\n") as file:
        file.write(output.getvalue())


if __name__ == "__main__":
    main()
