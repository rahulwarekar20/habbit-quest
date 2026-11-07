# HabbitQuest product tour

What families see, screen by screen: kids play picture quests, grown-ups approve them, and an AI coach suggests what
to try next. Screenshots are from the running app (3 November 2026), with a test family: Sam, Maya (7) and Leo (10).

```mermaid
flowchart LR
    subgraph G["Grown-up"]
        P1["Sign in"] --> P2["Set up family"] --> P3["Pick quests<br/>catalog or coach"] --> P4["Approve<br/>PIN if set"] --> P5["Reward"]
    end
    subgraph K["Child"]
        K1["Kid mode"] --> K2["Picture quests"] --> K3["I did it!"] --> K4["Celebrate<br/>+Sparks, +points"] --> K5["Worlds, shop"]
    end
    K3 -- "waits for an OK" --> P4
    P4 -- "approved" --> K4
    K5 -- "asks" --> P5
```

## 1. Getting started

A family is set up in under a minute: sign in with Google, name the family, add the first child.

| Home | Sign-in |
|---|---|
| ![Home page](screenshots/01-home.jpg) | ![Sign-in](screenshots/02-sign-in.jpg) |
| **Step 1: the family** (the parent PIN is optional) | **Step 2: the first child** |
| ![Family setup](screenshots/03-family-setup.jpg) | ![First child](screenshots/04-first-child.jpg) |

More grown-ups join with an invite code; children can sign in on their own device with the family code (a QR code)
and their own PIN.

## 2. The parent dashboard

One screen answers "what needs me today?": quests waiting for approval, then each child's progress.

![Dashboard with three quests waiting](screenshots/05-dashboard.jpg)

## 3. Quest library

Up to 6 quests per child, each with its own time and days; harder tiers unlock as the child earns Sparks. Families can
add their own habits, such as "Practise piano"; their text never goes to the AI.

| A child's quests | Add quests: catalog by goal and age, plus the family's own |
|---|---|
| ![Quest library](screenshots/06-quest-library.jpg) | ![Add quests](screenshots/07-add-quests.jpg) |

## 4. Habit coach

A parent describes a problem; the coach crew answers with cited advice and quest cards. A real answer:

![The coach on "Maya melts down every evening when screen time ends"](screenshots/10-coach.jpg)

Nothing joins the plan until a grown-up taps Add. How the crew works: [03-ai-deep-dive.pdf](03-ai-deep-dive.pdf).

## 5. Kid mode

Picture-first, so a 3-year-old can use it without reading.

| Who's playing? | Today's quests |
|---|---|
| ![Who's playing](screenshots/11-whos-playing.jpg) | ![Today's quests](screenshots/12-kid-today.jpg) |
| **After "I did it!"** | **When a grown-up approves** |
| ![Waiting for a grown-up](screenshots/13-kid-waiting.jpg) | ![Celebration](screenshots/14-celebration.jpg) |

<img src="screenshots/18-kid-phone.jpg" alt="Kid mode on a phone" width="480">

## 6. Worlds, shop and journal

| A world | The reward shop | The field journal |
|---|---|---|
| ![Starter Camp](screenshots/15-world.jpg) | ![Reward shop](screenshots/16-shop.jpg) | ![Journal](screenshots/17-journal.jpg) |

## 7. Rewards, family settings and the PIN

| Rewards & limits | Family settings | The PIN, when a family turns it on |
|---|---|---|
| ![Rewards](screenshots/08-rewards.jpg) | ![Family settings](screenshots/09-family-settings.jpg) | ![PIN prompt](screenshots/19-pin.jpg) |

## 8. Every feature

| Area | Feature | Who |
|---|---|---|
| Accounts | Google sign-in, several grown-ups per family, invite codes | Grown-ups |
| Accounts | Kid sign-in on their own device: family code (QR) + kid PIN | Kids |
| Accounts | Optional parent PIN for approvals, rewards, leaving kid mode | Grown-ups |
| Plans | Catalog of 41 habits by age and tier; up to 30 custom habits | Grown-ups |
| Plans | Up to 6 quests per child, each with a time and days of the week | Grown-ups |
| Daily loop | Picture quests with clocks; I did it!; approve or Not yet | Both |
| Progress | Sparks (never lost), 6 worlds, harder tiers unlock, quest stars | Kids |
| Points | 10-20 per quest, boosts up to 3x (golden quest, streak, double day) | Kids |
| Rewards | Shop priced by grown-ups, mystery box, points held until approved | Both |
| Fun | Treasure chest, buddy wardrobe, surprises from grown-ups, journal | Kids |
| Wellbeing | Daily check-in (mood, stickers, note from age 6); safety alerts | Both |
| Limits | Daily time limit for kid mode with a friendly break screen | Grown-ups |
| AI | Habit coach crew, weekly review, quest planner, buddy lines | Grown-ups |
| Privacy | Export and delete the family; AI sees labels, never names | Grown-ups |
