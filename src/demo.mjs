import { answer } from './answers.mjs';
for (const question of ['How should I warm up?', 'How long should I rest between sets?', 'I missed a workout', 'My knee hurts and I have pain']) {
  console.log(`Trainee: ${question}\nTrainer bot: ${answer(question)}\n`);
}
