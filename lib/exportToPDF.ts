import jsPDF from 'jspdf';

export interface ExportData {
  title: string;
  summary: string;
  sections: Array<{ heading: string; content: string }>;
  filename: string;
}

export function exportToPDF(data: ExportData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 20;
  const marginRight = 20;
  const marginTop = 20;
  const marginBottom = 25;
  const maxWidth = pageWidth - marginLeft - marginRight;

  let yPosition = marginTop;
  let pageNumber = 1;

  // Helper function to add footer
  const addFooter = () => {
    doc.setFontSize(9);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Page ${pageNumber}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    doc.setTextColor(0, 0, 0);
  };

  // Helper function to check if we need a new page
  const checkNewPage = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - marginBottom) {
      addFooter();
      doc.addPage();
      pageNumber++;
      yPosition = marginTop;
      return true;
    }
    return false;
  };

  // Title
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  const


    titleLines = doc.splitTextToSize(data.title, maxWidth);
  titleLines.forEach((line: string) => {
    doc.text(line, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;
  });
  yPosition += 10;

  // Executive Summary (only if exists)
  if (data.summary && data.summary.trim()) {
    checkNewPage(20);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Executive Summary', marginLeft, yPosition);
    yPosition += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
  }

  // Conversation label patterns with colors
  const labelPatterns = [
    { pattern: /^\*\*\[USER\]\*\*/, label: '[USER]', color: [139, 92, 246] as [number, number, number] },
    { pattern: /^\*\*\[EXPLANATION\]\*\*/, label: '[EXPLANATION]', color: [204, 85, 0] as [number, number, number] },
    { pattern: /^\*\*\[INQUIRY\]\*\*/, label: '[INQUIRY]', color: [255, 215, 0] as [number, number, number] },
    { pattern: /^\*\*\[QUIZ \(MC\)\]\*\*/, label: '[QUIZ (MC)]', color: [239, 68, 68] as [number, number, number] },
    { pattern: /^\*\*\[QUIZ \(FR\)\]\*\*/, label: '[QUIZ (FR)]', color: [239, 68, 68] as [number, number, number] },
    { pattern: /^\*\*\[CONNECTION\]\*\*/, label: '[CONNECTION]', color: [0, 255, 212] as [number, number, number] },
    { pattern: /^\*\*\[SYNTHESIS\]\*\*/, label: '[SYNTHESIS]', color: [168, 85, 247] as [number, number, number] }
  ];

  // Helper to process a line and check for conversation labels
  const processLine = (line: string) => {
    // Check for conversation labels
    for (const labelPattern of labelPatterns) {
      const match = line.match(labelPattern.pattern);
      if (match) {
        const labelText = labelPattern.label || match[0].replace(/^\*\*\[|\]\*\*$/g, '');
        const restOfLine = line.substring(match[0].length).trim();
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const indent = marginLeft + (leadingSpaces / 2) * 12.7; // 2 spaces ≈ 0.5 inch ≈ 12.7mm

        checkNewPage(7);

        // Draw colored bold label
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(labelPattern.color[0], labelPattern.color[1], labelPattern.color[2]);
        doc.text(`[${labelText}]`, indent, yPosition);

        // Calculate label width to position rest of text
        const labelWidth = doc.getTextWidth(`[${labelText}] `);

        // Draw rest of line in black
        if (restOfLine) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
          const wrappedLines = doc.splitTextToSize(restOfLine, maxWidth - (indent - marginLeft) - labelWidth);
          wrappedLines.forEach((wrapped: string, idx: number) => {
            if (idx > 0) {
              checkNewPage(7);
              doc.text(wrapped, indent, yPosition);
            } else {
              doc.text(wrapped, indent + labelWidth, yPosition);
            }
            yPosition += 7;
          });
        } else {
          doc.setTextColor(0, 0, 0);
          yPosition += 7;
        }

        return true; // Label was processed
      }
    }
    return false; // No label found
  };

  // Parse summary for bullet points and conversation labels (only if exists)
  if (data.summary && data.summary.trim()) {
    const summaryLinesArray = data.summary.split('\n');
    summaryLinesArray.forEach((line: string) => {
      if (!line.trim()) {
        yPosition += 3;
        return;
      }

      // Check for conversation labels first
      if (processLine(line)) {
        return;
      }

      // Main bullet
      if (line.match(/^-\s+/)) {
        checkNewPage(7);
        const bulletText = line.substring(2).trim();
        doc.text('•', marginLeft + 2, yPosition);
        const wrappedLines = doc.splitTextToSize(bulletText, maxWidth - 7);
        wrappedLines.forEach((wrapped: string, idx: number) => {
          if (idx > 0) checkNewPage(7);
          doc.text(wrapped, marginLeft + 7, yPosition);
          yPosition += 7;
        });
      }
      // Sub-bullet
      else if (line.match(/^\s{2,}-\s+/)) {
        checkNewPage(7);
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const indentLevel = Math.floor(leadingSpaces / 2);
        const indent = marginLeft + 7 + (indentLevel * 5);
        const bulletText = line.trim().substring(2).trim();
        doc.setFontSize(9);
        doc.text('◦', indent, yPosition);
        doc.setFontSize(11);
        const wrappedLines = doc.splitTextToSize(bulletText, maxWidth - (indent - marginLeft) - 5);
        wrappedLines.forEach((wrapped: string, idx: number) => {
          if (idx > 0) checkNewPage(7);
          doc.text(wrapped, indent + 5, yPosition);
          yPosition += 7;
        });
      }
      // Regular text with indentation
      else {
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const indent = marginLeft + (leadingSpaces / 2) * 12.7; // 2 spaces ≈ 0.5 inch
        const textLines = doc.splitTextToSize(line.trim(), maxWidth - (indent - marginLeft));
        textLines.forEach((textLine: string) => {
          checkNewPage(7);
          doc.text(textLine, indent, yPosition);
          yPosition += 7;
        });
      }
    });
    yPosition += 10;
  }

  // Sections
  data.sections.forEach((section, index) => {
    checkNewPage(25);

    // Section heading
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const headingLines = doc.splitTextToSize(section.heading, maxWidth);
    headingLines.forEach((line: string) => {
      checkNewPage(8);
      doc.text(line, marginLeft, yPosition);
      yPosition += 8;
    });
    yPosition += 5;

    // Section content
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    // Parse content line by line for bullet handling and conversation labels
    const lines = section.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        yPosition += 3;
        continue;
      }

      // Check for conversation labels first
      if (processLine(line)) {
        continue;
      }

      // Check for H3 heading (###)
      if (line.trim().startsWith('### ')) {
        checkNewPage(10);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(line.trim().substring(4), marginLeft, yPosition);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        yPosition += 8;
        continue;
      }

      // Check for main bullet (starts with -, not indented)
      if (line.match(/^-\s+/)) {
        checkNewPage(7);
        const bulletText = line.substring(2).trim();
        const bulletX = marginLeft + 2;
        const textX = marginLeft + 7;
        const availableWidth = maxWidth - 7;

        // Render bullet point
        doc.text('•', bulletX, yPosition);

        // Wrap and render bullet text
        const wrappedLines = doc.splitTextToSize(bulletText, availableWidth);
        wrappedLines.forEach((wrappedLine: string, idx: number) => {
          if (idx > 0) checkNewPage(7);
          doc.text(wrappedLine, textX, yPosition);
          yPosition += 7;
        });
        continue;
      }

      // Check for sub-bullet (starts with spaces then -)
      if (line.match(/^\s{2,}-\s+/)) {
        checkNewPage(7);
        const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
        const indentLevel = Math.floor(leadingSpaces / 2);
        const baseIndent = marginLeft + 7;
        const indent = baseIndent + (indentLevel * 5);
        const bulletX = indent;
        const textX = indent + 5;
        const availableWidth = maxWidth - (indent - marginLeft) - 5;

        const bulletText = line.trim().substring(2).trim();

        // Render sub-bullet with smaller symbol
        doc.setFontSize(9);
        doc.text('◦', bulletX, yPosition);
        doc.setFontSize(11);

        // Wrap and render sub-bullet text
        const wrappedLines = doc.splitTextToSize(bulletText, availableWidth);
        wrappedLines.forEach((wrappedLine: string, idx: number) => {
          if (idx > 0) checkNewPage(7);
          doc.text(wrappedLine, textX, yPosition);
          yPosition += 7;
        });
        continue;
      }

      // Regular text with indentation
      checkNewPage(7);
      const leadingSpaces = line.match(/^(\s+)/)?.[1].length || 0;
      const indent = marginLeft + (leadingSpaces / 2) * 12.7; // 2 spaces ≈ 0.5 inch
      const textLines = doc.splitTextToSize(line.trim(), maxWidth - (indent - marginLeft));
      textLines.forEach((textLine: string) => {
        checkNewPage(7);
        doc.text(textLine, indent, yPosition);
        yPosition += 7;
      });
      yPosition += 3;
    }

    yPosition += 10; // Space after section
  });

  // Generated timestamp
  checkNewPage(20);
  yPosition += 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(128, 128, 128);
  doc.text(
    `Generated on ${new Date().toLocaleString()}`,
    marginLeft,
    yPosition
  );
  yPosition += 6;
  doc.text(
    '🤖 Generated with Astryon Portal',
    marginLeft,
    yPosition
  );

  // Add footer to last page
  addFooter();

  // Download
  console.log('📄 Generating PDF document...');
  doc.save(`${data.filename}.pdf`);
  console.log('✅ PDF document downloaded:', `${data.filename}.pdf`);
}
