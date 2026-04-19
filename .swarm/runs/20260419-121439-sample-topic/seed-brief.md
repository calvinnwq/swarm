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
