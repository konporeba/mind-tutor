# MindTutor — MVP Project Notes

## Project Name

MindTutor

## Main Problem

Manually studying course materials is time-consuming and inefficient. Learners (students, online course participants) lack a personalized, guided way to absorb uploaded content and verify their understanding before exams or assessments. They need an AI-powered tutor that adapts to who they are and how much time they have.

## Target User

Learners preparing for exams or assessments — university students, online course participants, or anyone studying structured material with a concrete deadline or goal.

## Core User Flow

1. Learner signs up with email and password.
2. Learner uploads up to 5 files (PDF or text) containing study materials.
3. AI tutor initiates a conversational profiling session — asking about the learner's background, experience level, goals, and available study time.
4. AI tutor guides the learner step by step through customized learning materials based on uploaded content and learner profile.
5. Exercises are generated and displayed alongside the guided material. Learner completes them and receives feedback.
6. Learner sees their performance score across completed exercises as a readiness signal.

## Minimum Feature Set

- **Authentication**: Email and password signup/login.
- **File upload**: Upload up to 5 files per session (PDF, text).
- **Conversational profiling**: AI tutor asks questions to build a learner profile (background, goals, available time) — no forms, done through chat.
- **Guided learning**: AI tutor walks the learner through the uploaded material step by step, tailored to their profile and timeframe.
- **Exercise generation**: AI generates various exercise types (multiple choice, fill-in-the-blank, domain-specific) based on the uploaded content.
- **Exercise feedback**: Learner completes exercises and gets immediate feedback with a performance score.
- **Supporting content**: Images extracted from uploaded files displayed alongside materials; AI-generated images as fallback when none exist.
- **Split-screen UI**: Left side — chat with AI tutor (theory + Q&A). Right side — exercises and supporting content.
- **Progress tracking**: Progress bar showing learner's position in the material (theory, exercises, etc.).
- **Data persistence**: Learner profiles, uploaded files, generated materials, exercises, scores, and conversation history stored in database.

## What is NOT in Scope for the MVP

- Web scraping / internet search for learning materials.
- Mobile application (web only).
- Adaptive exercise sequencing based on performance (exercises are linear, not adaptive).
- Multi-session course planning (breaking content into modules across days/weeks).
- Premium tier with higher file limits.
- Sharing or collaboration features.
- Import of formats beyond PDF and text (e.g., DOCX, PPTX).
- Custom spaced repetition algorithms.
- Integration with external learning platforms.

## Business Logic (one sentence)

AI tutor analyzes uploaded study materials and the learner's profile to generate a guided, time-boxed learning experience with exercises, providing a performance score as a readiness signal.

## Success Criteria

- Learner can upload files, complete a profiling conversation, and receive a guided learning session with exercises in a single sitting.
- AI-generated materials and exercises are relevant to the uploaded content and adapted to the learner's profile.
- Learner receives a performance score after completing exercises that reflects their understanding of the material.
- The first working flow (upload → profile → learn → exercise → score) is achievable within 3 weeks of part-time work.

## Open Questions (for /10x-shape to explore)

- What specific profiling fields matter most for meaningful personalization?
- How should the AI tutor handle files with no extractable images?
- What is the exact structure of the progress bar (sections, milestones)?
- How is conversation history managed — can learners resume a previous session?
- What AI model and infrastructure will power the tutor?
- How should exercise difficulty be calibrated without adaptive logic?
