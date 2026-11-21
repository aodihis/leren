---
name: structure-knowledge
description: Turns knowledge that the user wrote or pasted, often long, unordered or covering several subjects, into separate knowledge items that each have one topic and one response. Use it when the user's input is not already a single clear topic with a response.
---

# Structure knowledge

Leren saves each knowledge item as a topic and a response. This skill turns the user's raw text into drafts of such items. It only produces drafts. The user reviews them before anything is saved.

## Output

Produce one draft per subject. Each draft has:

- **Topic:** A short label of the subject, up to 200 characters. A reader should know from the topic alone what the item is about. Write a noun phrase, not a question.
- **Response:** What Leren may say to a sender about that subject, up to 5,000 characters. Write it in the first person as the user would say it, in the user's language and tone.

Add examples, restrictions or contacts only when the user's text clearly contains them: sample phrasings go to examples, things that must not be said go to restrictions, and people to point to go to contacts. Do not ask for them and do not invent them.

## Steps

1. Read the whole input before splitting it.
2. Split by subject. Two facts belong in the same item only if one sender question or request would need both. A schedule and a refund policy are two items. The opening hours and the address of the same office may be one item.
3. Keep every fact that the user gave about a subject, and keep it under that subject even when the user mentioned it far from the rest.
4. Remove only what carries no information for a sender: repetition, filler, and remarks the user made to themselves. Do not remove a fact because it seems minor.
5. Keep the user's meaning exactly. Do not add facts, numbers, dates, names or promises. Do not make the text more certain, more polite about commitments, or more detailed than the user wrote it.
6. Write each response so that it is complete without the rest of the input. Replace phrases such as "as mentioned above" with what they refer to.

## When something is unclear

Do not guess. Ask the user, in one message, about each thing you cannot resolve. Typical cases:

- A fact is ambiguous, or two statements contradict each other.
- A pronoun or a term could refer to more than one thing.
- A date, a price or a condition seems to be missing and the response is not useful without it.
- It is unclear which subject a sentence belongs to.
- Part of the input is not knowledge for senders, such as a note to self, and you are unsure whether to keep it.

Draft what is clear, and ask about the rest.

## Presenting the drafts

Show the drafts as a numbered list, each with its topic and response. State how many items you made. Then ask the user to confirm, change, merge, split or drop any of them. Do not save anything yet.
