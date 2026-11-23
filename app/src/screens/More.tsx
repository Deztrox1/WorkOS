import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { GROUP_LABEL as LABEL, moreItems, useClaudeWaiting, useUnread } from '../components/Shell';

export function More() {
  const unread = useUnread();
  const waiting = useClaudeWaiting();
  let last = '';
  return (
    <div className="sheetpaper page">
      <div className="page-h"><h1>More</h1></div>
      <nav className="more-list" aria-label="More">
        {moreItems().map((i) => {
          const head = i.group !== last ? <div className="more-group">{LABEL[i.group]}</div> : null;
          last = i.group;
          return (
            <div key={i.to}>
              {head}
              <Link to={i.to} className="tap" style={{ justifyContent: 'flex-start' }}>
                <i.icon size={20} aria-hidden />
                <span style={{ flex: 1 }}>{i.label}</span>
                {i.badge && unread > 0 && <span className="badge">{unread}</span>}
                {i.dot && waiting > 0 && <span className="dot-mark" data-testid="more-claude-dot" role="img" aria-label="A Claude result is waiting" />}
                <ChevronRight size={16} className="go" aria-hidden />
              </Link>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
