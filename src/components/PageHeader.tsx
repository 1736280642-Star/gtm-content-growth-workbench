import { Space } from "antd";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  titleExtra?: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, titleExtra, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <div className="page-header-title-row">
          <h1 className="page-title">{title}</h1>
          {titleExtra ? <div className="page-title-extra">{titleExtra}</div> : null}
        </div>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <Space>{actions}</Space> : null}
    </div>
  );
}
