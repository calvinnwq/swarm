# Swarm Round Brief

Topic: sample topic
Round: 1/2
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
No prior round packet yet. This is the opening round.

## Instructions
Stay inside the shared swarm JSON schema.
Make your answer concise, concrete, and round-aware.
If questionResolutions appear in the prior round packet, treat the top blocking ones as the swarm's current working answers unless you are explicitly overturning them.
If a prior questionResolution is marked deferred, leave it parked unless you now have enough evidence in-round to answer it cleanly.
If this is not the final round, respond to the prior packet rather than restating the seed brief.
