/**
 * Knowledge base for the habit coach's retrieval (RAG): short, general parenting guidance on
 * children's habits. The coach searches it (server/rag.ts) and cites what it uses.
 *
 * Content is general guidance, not medical advice. Where a well-known public guideline is
 * mentioned, its source is named in the text. Each "## " section becomes one searchable chunk.
 * Add articles by appending to KNOWLEDGE; no other change is needed.
 */

export interface KnowledgeDoc {
  id: string;
  title: string;
  ages: [number, number];
  body: string;
}

export const KNOWLEDGE: KnowledgeDoc[] = [
  {
    id: "sleep",
    title: "Sleep for growing kids",
    ages: [3, 13],
    body: `
## How much sleep children need
The American Academy of Sleep Medicine, with the American Academy of Pediatrics' endorsement, recommends 10 to 13 hours of sleep (including naps) for children aged 3 to 5, 9 to 12 hours for ages 6 to 12, and 8 to 10 hours for teenagers. Work backwards from wake-up time to choose a bedtime that fits.

## Keep bedtime consistent
A regular bedtime and wake time, including on weekends where possible, helps the body clock settle. Shifting a late bedtime earlier works best in small steps of 10 to 15 minutes every few nights rather than one big change.

## Bedtime resistance and stalling
Many children stall at bedtime with extra requests. A predictable routine, a picture checklist, one agreed "last request" and calm, boring responses to repeated get-ups reduce the battle. Praise the next morning for staying in bed works better than arguing at night.

## Night-time fears
Fears of the dark are common in preschool and early school years. A dim night light, a comfort object and a short, reassuring check-in help. Avoid scary shows close to bedtime.
`,
  },
  {
    id: "bedtime-routine",
    title: "Calm bedtime routines",
    ages: [3, 13],
    body: `
## A simple wind-down sequence
A short sequence repeated every night signals that sleep is coming: bath or wash, pyjamas, brush teeth, toilet, a story, lights out. Keep it to about 20 to 30 minutes and in the same order.

## Screens before bed
Screens are stimulating and the light can delay sleepiness. Many families switch screens off about an hour before bed and keep devices out of the bedroom overnight.

## Transitions into bedtime
Give a 10-minute and a 5-minute warning before the routine starts. Visual timers help younger children see how long is left, so the switch feels less sudden.
`,
  },
  {
    id: "screen-time",
    title: "Screen time balance",
    ages: [3, 13],
    body: `
## Guidance by age
The American Academy of Pediatrics suggests about one hour a day of high-quality programming for children aged 2 to 5, ideally watched with a grown-up. For school-age children it recommends consistent limits that protect sleep, physical activity, homework and family time, set out in a family media plan.

## Ending screen time without a meltdown
Most screen-time battles happen at the switch-off. Agree the limit before the screen goes on, use a timer the child can see, give a five-minute warning, and use "when-then" language: "When the timer rings, then we'll go outside." Praise smooth switch-offs.

## Screen-free zones and times
Keeping meals and bedrooms screen-free protects conversation and sleep. Replacing some screen time with an inviting alternative, like outdoor play, building toys or reading together, works better than simply removing it.

## Using rewards around screens
If extra screen time is used as a reward, keep it small and occasional so screens don't become the only thing a child works for. Rewarding a calm switch-off is often more useful than rewarding more minutes.
`,
  },
  {
    id: "mornings",
    title: "Smooth mornings and getting ready",
    ages: [3, 13],
    body: `
## Prepare the night before
Laying out clothes, packing the school bag and checking tomorrow's plan the evening before removes many morning decisions and arguments.

## Picture checklists
A short picture checklist (get up, toilet, dress, breakfast, teeth, shoes) lets children follow the routine themselves instead of being told each step. Even children who can't read can follow pictures.

## Getting up on time
A consistent wake time, an alarm clock the child controls (for older children) and opening the curtains to let daylight in help. If mornings are a struggle, check that bedtime gives enough sleep.
`,
  },
  {
    id: "homework",
    title: "Homework habits",
    ages: [5, 13],
    body: `
## Same time, same place
A regular homework time and a quiet spot with supplies ready makes starting easier. Some children work best after a snack and short break; others prefer to finish before play.

## Getting started
Starting is often the hardest part. Break the work into small chunks, start with an easy task to build momentum, and use a timer for short focused bursts with breaks in between.

## How much help to give
Be nearby and available, but let the child do the work. Ask guiding questions rather than giving answers, and praise effort and strategies ("you kept going on a tricky problem") rather than only results.

## Building independence
As children grow, gradually move from sitting with them, to checking in, to having them plan their own homework time. "Start without reminders" is a good goal for older primary-school children.
`,
  },
  {
    id: "mealtimes",
    title: "Mealtimes and picky eating",
    ages: [3, 13],
    body: `
## Repeated, low-pressure tasting
Children often need to try a new food many times, sometimes ten or more, before accepting it. Offer small portions alongside familiar foods and invite one "brave bite" without pressure, bribes or forcing.

## Family meals
Eating together, without screens, gives children a chance to see others enjoy varied foods and to talk about their day. Even a few shared meals a week help.

## Finishing meals on time
Long, drawn-out meals are common. A relaxed but clear end time, a visual timer and removing distractions like toys and screens help. Avoid using dessert as a reward for finishing.

## Drinks
Water and milk are the best everyday drinks for children; sugary drinks are best kept occasional. A water habit at each meal is an easy place to start.
`,
  },
  {
    id: "activity",
    title: "Active play",
    ages: [3, 13],
    body: `
## How much activity children need
World Health Organization guidelines recommend that children aged 3 to 4 spend at least 180 minutes a day in a variety of physical activities, including at least 60 minutes of moderate-to-vigorous activity. Children and teenagers aged 5 to 17 should average at least 60 minutes a day of moderate-to-vigorous activity, mostly aerobic.

## Making movement fun
Play counts: tag, dancing, bike rides, playgrounds and walks to school all add up. Letting children choose the activity increases how much they do. Outdoor time also helps sleep.

## Active breaks
Short movement breaks between homework chunks or after screen time help children reset and focus.
`,
  },
  {
    id: "feelings",
    title: "Big feelings and tantrums",
    ages: [3, 13],
    body: `
## Naming feelings
Helping children put feelings into words ("you're frustrated the game ended") is one of the most effective ways to calm big emotions. A daily "feelings check" builds this skill.

## Calm-down tools
Slow breathing (such as "smell the flower, blow out the candle" or "dragon breaths"), a calm corner with soft items, squeezing a cushion or counting can all help. Practise them when the child is calm so they're ready when needed.

## During and after a meltdown
Stay calm and close, keep words few, and keep everyone safe. Once calm, talk briefly about what happened and what could help next time. Avoid long lectures during the storm.

## When transitions trigger tantrums
Many meltdowns happen when one activity ends, like screens, play or leaving the park. Warnings, timers and a predictable routine make transitions easier.
`,
  },
  {
    id: "chores",
    title: "Chores and responsibility by age",
    ages: [3, 13],
    body: `
## Age-appropriate jobs
Ages 3 to 5 can put toys away, put clothes in the laundry basket, help set the table and feed a pet with help. Ages 6 to 9 can make their bed, pack their school bag, help with simple meal prep and water plants. Ages 10 to 13 can manage their own laundry steps, simple cooking with supervision and regular household chores.

## Teaching a new job
Show the job, do it together, then let the child do it while you watch, before expecting it independently. Accept "good enough" at first and praise the effort.

## Toy tidy-up
Make tidying easy with labelled bins and pictures of what goes where. A short tidy-up song or a five-minute timer turns it into a game.
`,
  },
  {
    id: "kindness",
    title: "Kindness, manners and getting along",
    ages: [3, 13],
    body: `
## Modelling and noticing
Children copy what they see. Using please and thank you yourself, and noticing kind acts out loud ("you shared your crayons, that was kind"), encourages more of them.

## Sibling conflict
Avoid comparing siblings or making them compete. Teach simple problem-solving: each child says what they want, then they think of a fair solution together. Step in quickly if anyone could be hurt.

## Small daily kindness
A daily kindness mission, like helping someone, sharing or including a classmate, gives children a concrete way to practise empathy.
`,
  },
  {
    id: "hygiene",
    title: "Healthy hygiene habits",
    ages: [3, 13],
    body: `
## Tooth brushing
Dental organisations such as the American Dental Association recommend brushing twice a day for two minutes with fluoride toothpaste: a rice-grain-sized smear for children under 3 and a pea-sized amount for ages 3 to 6. Young children usually need a grown-up to help or check until about age 7 or 8.

## Handwashing
Public health guidance, such as from the US CDC, recommends washing hands with soap and water for at least 20 seconds, about two rounds of "Happy Birthday", before eating and after using the toilet.

## Making it fun
A two-minute timer or song, a picture chart and letting the child pick their toothbrush help make hygiene a habit instead of a battle.
`,
  },
  {
    id: "reading",
    title: "Reading every day",
    ages: [3, 13],
    body: `
## Daily reading
Reading every day, even for a few minutes, builds vocabulary and a love of books. For young children, being read to counts.

## Keep reading aloud
Reading aloud stays valuable even after children can read alone; it introduces richer books than they can read independently and is a calm shared moment.

## Choice and variety
Letting children choose what they read, including comics, information books and magazines, increases how much they read. Short, regular sessions beat occasional long ones.
`,
  },
  {
    id: "motivation",
    title: "Motivation, praise and rewards",
    ages: [3, 13],
    body: `
## Praise effort, be specific
Specific praise for effort and strategies ("you remembered your bag all by yourself") builds persistence more than general praise ("good job") or praise for being clever.

## Using rewards well
Small, immediate rewards work best for younger children; older children can save towards bigger goals. Rewards help start a habit; as it becomes routine, fade them gradually and keep the praise.

## Avoid punishing with rewards
Taking earned points or rewards away as punishment tends to reduce motivation and trust. Keep earned rewards earned, and handle misbehaviour separately.

## Don't use food as a reward
Using sweets as rewards can create an unhealthy relationship with food. Privileges, special time together and small treats work well instead.
`,
  },
  {
    id: "new-habits",
    title: "Building a new habit",
    ages: [3, 13],
    body: `
## Start small and specific
Choose one or two small, concrete habits at a time, for example "put toys in the bin after play" rather than "be tidy". Success with small steps builds confidence for bigger ones.

## Anchor to an existing routine
Attach the new habit to something that already happens: "after breakfast, I brush my teeth" or "after dinner, I pack my bag". The existing routine becomes the reminder.

## Consistency over perfection
Habits form through repetition. Missing a day is normal; what matters is getting back on track. Celebrate streaks, but don't make a missed day a big deal.

## Track and celebrate
Visual tracking like stickers, stars or a progress bar makes progress visible to children and keeps them motivated.
`,
  },
  {
    id: "extra-support",
    title: "When to get extra support",
    ages: [3, 13],
    body: `
## Signs to talk to a professional
Talk to your child's doctor or school if sleep problems, worries, anger, eating difficulties or school refusal last for weeks, get worse, or affect daily life. Getting help early is a strength, not a failure.

## Urgent concerns
If a child talks about hurting themselves, says someone is hurting them, or seems in danger, seek help straight away: contact your local emergency number, a children's helpline or your doctor. A habit app is not the right tool for emergencies.
`,
  },
];
