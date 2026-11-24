---
name: structure-knowledge
description: Turns knowledge that the user wrote or pasted, often long, unordered or covering several subjects, into separate playbooks that each have one topic and its information. Use it when the user's input is not already a single clear topic with information.
---

# Structure knowledge

Each playbook is saved with a topic and information. This skill turns the user's raw text into drafts of such playbooks. It only produces drafts. The user reviews them before anything is saved.

## Output

Produce one draft playbook per subject. Each draft has:

- **Topic:** A short label of the subject, up to 200 characters. A reader should know from the topic alone what the playbook is about. Write a noun phrase, not a question.
- **Information:** What the assistant knows about that subject, up to 5,000 characters. Write it as plain facts in the user's language, so that an answer can be written from it.

Add an instruction only when the user's text clearly contains one, such as a tone or something that must not be said. Keep any person to contact in the information. Do not ask for an instruction and do not invent one.

## Steps

1. Read the whole input before splitting it.
2. Split by subject. Two facts belong in the same playbook only if one sender question or request would need both. A schedule and a refund policy are two playbooks. The opening hours and the address of the same office may be one playbook.
3. Keep every fact that the user gave about a subject, and keep it under that subject even when the user mentioned it far from the rest.
4. Remove only what carries no information for a sender: repetition, filler, and remarks the user made to themselves. Do not remove a fact because it seems minor.
5. Keep the user's meaning exactly. Do not add facts, numbers, dates, names or promises. Do not make the text more certain, more polite about commitments, or more detailed than the user wrote it.
6. Write each piece of information so that it is complete without the rest of the input. Replace phrases such as "as mentioned above" with what they refer to.

## When something is unclear

Do not guess. Ask the user, in one message, about each thing you cannot resolve. Typical cases:

- A fact is ambiguous, or two statements contradict each other.
- A pronoun or a term could refer to more than one thing.
- A date, a price or a condition seems to be missing and the information is not useful without it.
- It is unclear which subject a sentence belongs to.
- Part of the input is not knowledge for senders, such as a note to self, and you are unsure whether to keep it.

Draft what is clear, and ask about the rest.

## Presenting the drafts

Show the drafts as a numbered list, each with its topic and information. State how many playbooks you made. Then ask the user to confirm, change, merge, split or drop any of them. Do not save anything yet.
