let meta = #{
    name: "review-changes",
    description: "Review a diff across dimensions, adversarially verify each finding",
    when_to_use: "independent multi-dimension code review of a known path, branch, or diff",
    phases: [
        #{ title: "Review", detail: "one reviewer per dimension" },
        #{ title: "Verify", detail: "one skeptic per finding" },
    ],
};

let findings_schema = #{
    "type": "object", "required": ["findings"],
    "properties": #{
        "findings": #{ "type": "array", "maxItems": 8, "items": #{
            "type": "object", "required": ["file", "issue"],
            "properties": #{
                "file": #{ "type": "string" },
                "issue": #{ "type": "string" },
            },
        }},
    },
};
let verdict_schema = #{
    "type": "object", "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

const MAX_FINDINGS = 16;

fn trimmed(s) {
    if type_of(s) == "string" { s.trim(); s } else { "" }
}

let target = if args == () { () } else { args.target };
if target == () { pause("verification", "Pass args.target — the diff, branch, or path to review."); }
let target_text = json_encode(target);

phase("Review");
let dimensions = ["correctness bugs", "error handling gaps", "performance problems"];
let jobs = [];
for d in dimensions {
    let prompt = "Review " + target_text + " for " + d + ". ";
    prompt += "Use read-only tools (read_file, grep, git diff) to inspect the actual code — do not answer from memory. ";
    prompt += "Report at most 8 concrete findings as {file, issue}; an empty list is a valid answer only after you have read the code.";
    jobs.push(#{
        prompt: prompt,
        label: "review:" + d,
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
let dropped = 0;
for r in results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings {
            if findings.len() < MAX_FINDINGS {
                findings.push(f);
            } else {
                dropped += 1;
            }
        }
    }
}
if dropped > 0 { log("Dropped " + dropped.to_string() + " findings past cap " + MAX_FINDINGS.to_string()); }
if findings.len() == 0 { complete(#{ summary: "No findings.", confirmed: [] }); }

phase("Verify");
let vjobs = [];
for f in findings {
    let file = trimmed(f.file);
    let issue = json_encode(f.issue);
    let prompt = "Adversarially verify this review finding by reading the shipped code: ";
    prompt += issue + " in " + file + ". ";
    prompt += "Set real=true only with concrete evidence you independently inspected. Otherwise default real=false.";
    vjobs.push(#{
        prompt: prompt,
        label: "verify:" + file,
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);

let confirmed = [];
let i = 0;
for v in verdicts {
    if v != () && v.success && v.output.real == true {
        let evidence = trimmed(v.output.evidence);
        if evidence != "" {
            confirmed.push(findings[i]);
        }
    }
    i += 1;
}
log(confirmed.len().to_string() + "/" + findings.len().to_string() + " findings survived verification");
complete(#{ summary: confirmed.len().to_string() + " confirmed findings", confirmed: confirmed });
