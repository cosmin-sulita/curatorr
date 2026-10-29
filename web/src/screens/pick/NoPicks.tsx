import { ChevronLeft, RotateCcw } from 'lucide-react';
import { CenteredState, Shell } from '../../components/Shell';
import { Button } from '../../components/ui';
import { navigate } from '../../lib/router';

/**
 * Nothing left to show: every pick was passed on (`hadPicks`), or nothing matched at all. Says why in the words of how
 * the picks were asked for (answers, a shortcut, "Something like…"), and how to go on.
 */
export function NoPicks({
  hadPicks,
  like,
  likeTitle,
  shortcut,
  lookAgain,
  looking,
}: {
  hadPicks: boolean;
  like: boolean;
  likeTitle: string | undefined;
  shortcut: boolean;
  lookAgain: () => void;
  looking: boolean;
}) {
  let title = hadPicks ? "That's every match" : 'Nothing fits those answers';
  let hint = hadPicks ? 'You passed on all of them. Change an answer or look again.' : 'Try a different combination of answers.';
  if (like) {
    if (!hadPicks) title = 'Nothing like that left to watch';
    hint = hadPicks
      ? 'You passed on all of them. Pick another movie or look again.'
      : `You've seen everything like ${likeTitle ?? 'it'}. Try another movie.`;
  } else if (shortcut) {
    if (!hadPicks) title = 'Nothing to pick right now';
    hint = hadPicks ? 'You passed on all of them. Look again, or answer the questions instead.' : 'Answer the questions instead.';
  }
  return (
    <Shell>
      <CenteredState title={title}>
        <p className="text-muted">{hint}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => window.history.back()}>
            <ChevronLeft className="size-4" /> {like ? 'Pick another movie' : shortcut ? 'Back' : 'Change answers'}
          </Button>
          {hadPicks && (
            <Button onClick={lookAgain} loading={looking}>
              Look again
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/', { back: true })}>
            <RotateCcw className="size-4" /> Start over
          </Button>
        </div>
      </CenteredState>
    </Shell>
  );
}
