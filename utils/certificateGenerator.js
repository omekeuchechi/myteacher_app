const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const generateCertificate = async (userName, courseName, lectureId) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                layout: 'landscape',
                size: 'A4',
            });

            // Collect PDF data in chunks
            const chunks = [];
            
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => {
                const result = Buffer.concat(chunks);
                const base64String = result.toString('base64');
                const dataUrl = `data:application/pdf;base64,${base64String}`;
                resolve(dataUrl);
            });

            // Certificate design
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8f9fa');
            
            // Border
            doc.strokeColor('#3498db')
               .lineWidth(20)
               .rect(40, 40, doc.page.width - 80, doc.page.height - 80)
               .stroke();

            // Header
            doc.fontSize(32)
               .fill('#2c3e50')
               .font('Helvetica-Bold')
               .text('CERTIFICATE OF COMPLETION', {
                   align: 'center',
                   width: doc.page.width - 100,
                   lineGap: 10
               });

            // Body
            doc.moveDown(2)
               .fontSize(20)
               .fill('#34495e')
               .font('Helvetica')
               .text('This is to certify that', { align: 'center' });

            doc.moveDown()
               .fontSize(32)
               .fill('#2c3e50')
               .font('Helvetica-Bold')
               .text(userName, { align: 'center' });

            doc.moveDown()
               .fontSize(18)
               .fill('#34495e')
               .font('Helvetica')
               .text('has successfully completed the course', { align: 'center' });

            doc.moveDown()
               .fontSize(24)
               .fill('#3498db')
               .font('Helvetica-Bold')
               .text(courseName, { align: 'center' });

            // Footer
            const date = new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            doc.moveDown(4)
               .fontSize(14)
               .fill('#7f8c8d')
               .text(`Certificate ID: ${lectureId.toString().slice(-8).toUpperCase()}`, 100, doc.page.height - 200, {
                   width: 200,
                   align: 'left'
               })
               .text(`Date: ${date}`, -100, doc.page.height - 200, {
                   width: 200,
                   align: 'right'
               });

            // Finalize the PDF
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

module.exports = { generateCertificate };
