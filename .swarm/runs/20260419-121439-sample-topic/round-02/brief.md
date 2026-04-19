# Swarm Round Brief

Topic: sample topic
Round: 2/2
Preset: none
Agents: alpha, beta
Selection source: explicit-agents

## Seed Brief
# Swarm Brief

Topic: sample topic
Rounds: 2
Selection source: explicit-agents
Preset: none
Agents: alpha, beta
Resolution mode: orchestrator
Goal: n/a
Decision target: n/a
Carry-forward docs: n/a

## Output contract
Return the shared swarm JSON schema with fields:
agent, round, stance, recommendation, reasoning, objections, risks, changesFromPriorRound, confidence, openQuestions

## Round instructions
Round 1: independent stance + recommendation + risks.
Round 2: respond to the compacted round-1 packet.
Round 3: converge or finalize only.

## Resolution mode
Explicit resolution is enabled. The orchestrator runs the question-resolution sub-pass between rounds before continuing.

## Prior Round Packet
```json
{
  "round": 1,
  "agents": [
    "alpha",
    "beta"
  ],
  "summaries": [
    {
      "agent": "alpha",
      "stance": "The topic is too underspecified to take a meaningful position. A concrete decision question, success criteria, and constraints are needed before the swarm can produce actionable output.",
      "recommendation": "Before proceeding to round 2, the orchestrator should resolve the open questions below so that agents can deliver concrete, differentiated analysis rather than generic placeholder responses.",
      "objections": [
        "Proceeding to round 2 without clarification risks producing a synthesis that appears authoritative but has no grounding."
      ],
      "risks": [
        "If the topic remains unspecified, the swarm output will be vacuous and could mislead consumers into thinking deliberation occurred.",
        "The two-round budget leaves no room for recovery if round 2 is also spent on meta-discussion."
      ],
      "confidence": "low",
      "openQuestions": [
        "What is the actual decision or question the swarm should deliberate on?",
        "Who is the intended audience for the swarm's output, and what action will they take based on it?",
        "Are there constraints (timeline, budget, technical) that should bound the recommendation space?"
      ]
    },
    {
      "agent": "beta",
      "stance": "The topic as stated ('sample topic') lacks specificity; the swarm cannot produce actionable output without a concrete problem statement, defined options, and evaluation criteria.",
      "recommendation": "Pause substantive analysis. Use the orchestrator resolution pass to inject a real decision target, or explicitly acknowledge this round as a dry-run calibration of the swarm process itself.",
      "objections": [
        "Generating substantive recommendations on an undefined topic creates an illusion of rigor and sets a bad precedent for future rounds.",
        "Any 'consensus' reached in Round 2 would be an artifact of agents converging on shared assumptions rather than shared evidence."
      ],
      "risks": [
        "Agents may fill the ambiguity vacuum with plausible-sounding but unfounded positions, producing a synthesis that appears authoritative but is hollow.",
        "If the orchestrator resolution pass does not surface new constraints or a real topic, Round 2 will degenerate into meta-discussion about the process rather than converging on substance.",
        "Confidence scores will be unreliable—agents cannot honestly assess confidence in positions that have no grounding."
      ],
      "confidence": "low",
      "openQuestions": [
        "Is 'sample topic' a placeholder for a real topic that will be injected before Round 2, or is this swarm run intended as a process test?",
        "If this is a process test, what specific aspects of swarm behavior are being evaluated?",
        "What decision framework should agents default to when no evaluation criteria are provided?",
        "Should agents flag underspecified briefs as blockers or attempt best-effort analysis regardless?"
      ]
    }
  ],
  "keyObjections": [
    "Proceeding to round 2 without clarification risks producing a synthesis that appears authoritative but has no grounding.",
    "Generating substantive recommendations on an undefined topic creates an illusion of rigor and sets a bad precedent for future rounds.",
    "Any 'consensus' reached in Round 2 would be an artifact of agents converging on shared assumptions rather than shared evidence."
  ],
  "sharedRisks": [],
  "openQuestions": [
    "What is the actual decision or question the swarm should deliberate on?",
    "Who is the intended audience for the swarm's output, and what action will they take based on it?",
    "Are there constraints (timeline, budget, technical) that should bound the recommendation space?",
    "Is 'sample topic' a placeholder for a real topic that will be injected before Round 2, or is this swarm run intended as a process test?",
    "If this is a process test, what specific aspects of swarm behavior are being evaluated?",
    "What decision framework should agents default to when no evaluation criteria are provided?",
    "Should agents flag underspecified briefs as blockers or attempt best-effort analysis regardless?"
  ],
  "questionResolutions": [],
  "questionResolutionLimit": 0,
  "deferredQuestions": []
}
```

## Instructions
Stay inside the shared swarm JSON schema.
Make your answer concise, concrete, and round-aware.
If questionResolutions appear in the prior round packet, treat the top blocking ones as the swarm's current working answers unless you are explicitly overturning them.
If a prior questionResolution is marked deferred, leave it parked unless you now have enough evidence in-round to answer it cleanly.
If this is not the final round, respond to the prior packet rather than restating the seed brief.
