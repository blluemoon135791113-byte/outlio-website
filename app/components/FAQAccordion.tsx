"use client";

import { useId, useState } from "react";
import styles from "./FAQSection.module.css";

type FAQ = { q: string; a: string };

export default function FAQAccordion({ faqs }: { faqs: ReadonlyArray<FAQ> }) {
  const [openItems, setOpenItems] = useState<Set<number>>(() => new Set());
  const baseId = useId();

  const toggle = (index: number) => {
    setOpenItems((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className={styles.questions}>
      {faqs.map((faq, index) => {
        const isOpen = openItems.has(index);
        const answerId = `${baseId}-answer-${index}`;

        return (
          <div key={faq.q} className={styles.item} data-open={isOpen}>
            <h3 className={styles.questionHeading}>
              <button
                type="button"
                className={styles.trigger}
                aria-expanded={isOpen}
                aria-controls={answerId}
                onClick={() => toggle(index)}
              >
                <span>{faq.q}</span>
                <span className={styles.icon} aria-hidden="true">+</span>
              </button>
            </h3>
            <div id={answerId} className={styles.answerPanel} aria-hidden={!isOpen}>
              <div className={styles.answerInner}>
                <p className={styles.answer}>{faq.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
