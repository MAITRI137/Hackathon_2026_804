import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Page } from '@/app/Page';
import { Button, Card, EmptyState } from '@/ui/primitives';

export function NotFoundPage() {
  return (
    <Page title="Page not found" crumbs={['Navigation']}>
      <Card>
        <EmptyState
          icon={Compass}
          title="That page does not exist"
          description="The link may be out of date, or the screen may belong to a role you are not signed in as."
          action={
            <Link to="/">
              <Button variant="primary">Back to my dashboard</Button>
            </Link>
          }
        />
      </Card>
    </Page>
  );
}
