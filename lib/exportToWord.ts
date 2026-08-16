import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer, Footer, PageNumber, NumberFormat } from 'docx';
import { saveAs } from 'file-saver';

export interface ExportData {
  title: string;
  summary: string;
  sections: Array<{ heading: string; content: string }>;
  filename: string;
}

export async function exportToWord(data: ExportData) {
  // Helper function to parse markdown content into Word paragraphs with proper bullet formatting
  const createContentParagraphs = (content: string) => {
    const paragraphs: Paragraph[] = [];
    const lines = content.split('\n');

    // Conversation label detection with colors
    const labelPatterns = [
      { pattern: /^\*\*\[USER\]\*\*/, label: '[USER]', color: '8B5CF6' },
      { pattern: /^\*\*\[EXPLANATION\]\*\*/, label: '[EXPLANATION]', color: 'CC5500' },
      { pattern: /^\*\*\[INQUIRY\]\*\*/, label: '[INQUIRY]', color: 'FFD700' },
      { pattern: /^\*\*\[QUIZ \(MC\)\]\*\*/, label: '[QUIZ (MC)]', color: 'EF4444' },
      { pattern: /^\*\*\[QUIZ \(FR\)\]\*\*/, label: '[QUIZ (FR)]', color: 'EF4444' },
      { pattern: /^\*\*\[CONNECTION\]\*\*/, label: '[CONNECTION]', color: '00FFD4' },
      { pattern: /^\*\*\[SYNTHESIS\]\*\*/, label: '[SYNTHESIS]', color: 'A855F7' }
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      // Check for conversation labels (e.g., **[USER REPLY]**)
      let labelMatch = false;
      for (const labelPattern of labelPatterns) {
        const match = line.match(labelPattern.pattern);
        if (match) {
          const labelText = labelPattern.label || match[0].replace(/^\*\*\[|\]\*\*$/g, '');
          const restOfLine = line.substring(match[0].length).trim();

          // Get indent level from leading spaces
          const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
          const indentInches = (leadingSpaces / 2) * 0.5; // 2 spaces = 0.5 inch

          // Create paragraph with colored label
          const children: TextRun[] = [
            new TextRun({
              text: `[${labelText}]`,
              bold: true,
              color: labelPattern.color,
              font: 'Calibri',
              size: 24
            })
          ];

          // Add rest of line if present
          if (restOfLine) {
            children.push(
              new TextRun({
                text: ' ' + restOfLine,
                font: 'Calibri',
                size: 24
              })
            );
          }

          paragraphs.push(
            new Paragraph({
              children,
              spacing: { after: 120, before: 100 },
              indent: { left: Math.round(indentInches * 1440) } // Convert inches to twips
            })
          );

          labelMatch = true;
          break;
        }
      }

      if (labelMatch) continue;

      // Check for H3 heading (###)
      if (line.trim().startsWith('### ')) {
        paragraphs.push(
          new Paragraph({
            text: line.trim().substring(4),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 300, after: 150 }
          })
        );
      }
      // Check for main bullet (starts with -, not indented)
      else if (line.match(/^-\s+/)) {
        paragraphs.push(
          new Paragraph({
            text: line.substring(2).trim(),
            bullet: { level: 0 },
            spacing: { after: 120 }
          })
        );
      }
      // Check for sub-bullet (starts with spaces then -)
      else if (line.match(/^\s{2,}-\s+/)) {
        // Count leading spaces to determine indent level
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const level = Math.floor(leadingSpaces / 2); // 2 spaces = 1 level

        paragraphs.push(
          new Paragraph({
            text: line.trim().substring(2).trim(),
            bullet: { level: Math.min(level, 4) }, // Max 5 levels (0-4)
            spacing: { after: 120 }
          })
        );
      }
      // Regular text with proper indentation
      else {
        // Count leading spaces for indentation
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const indentInches = (leadingSpaces / 2) * 0.5; // 2 spaces = 0.5 inch

        paragraphs.push(
          new Paragraph({
            children: [new TextRun({
              text: line.trim(),
              font: 'Calibri',
              size: 24
            })],
            spacing: { after: 200 },
            indent: { left: Math.round(indentInches * 1440) } // Convert inches to twips
          })
        );
      }
    }

    return paragraphs;
  };

  // Build document children
  const documentChildren: Paragraph[] = [];

  // Title
  documentChildren.push(
    new Paragraph({
      text: data.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      style: 'Title'
    })
  );

  // Summary section (only if summary exists)
  if (data.summary && data.summary.trim()) {
    documentChildren.push(
      new Paragraph({
        text: 'Executive Summary',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    );

    documentChildren.push(...createContentParagraphs(data.summary));
  }

  // Add each section
  data.sections.forEach(section => {
    documentChildren.push(
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    );

    documentChildren.push(...createContentParagraphs(section.content));
  });

  // Generated timestamp
  documentChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `\n\nGenerated on ${new Date().toLocaleString()}`,
          italics: true,
          size: 20, // 10pt
          color: '666666'
        })
      ],
      spacing: { before: 400 }
    })
  );

  documentChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '🤖 Generated with ',
          size: 20
        }),
        new TextRun({
          text: 'Astryon Portal',
          size: 20,
          bold: true,
          color: '00FFD4'
        })
      ],
      spacing: { after: 200 }
    })
  );

  // Create document
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 1440, // 1 inch (1440 twips)
            right: 1440,
            bottom: 1440,
            left: 1440
          }
        }
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  font: 'Calibri',
                  size: 20
                })
              ]
            })
          ]
        })
      },
      children: documentChildren
    }]
  });

  // Generate and download
  console.log('📄 Generating Word document...');
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${data.filename}.docx`);
  console.log('✅ Word document downloaded:', `${data.filename}.docx`);
}
