const cron = require('node-cron');
const CertificateService = require('./certificateService');

class CertificateScheduler {
    static start() {
        // Run every day at midnight
        const timingTaskStageDev='*/1 * * * *'
        const timingTaskStagePro='0 0 * * *'

        let stagAction;

        if (process.env.STAG == 'DEVELOPMENT') {
            stagAction = timingTaskStageDev;
        } else if (process.env.STAG == 'PRODUCTION') {
            stagAction = timingTaskStagePro;
        }

        cron.schedule(stagAction, async () => {
            console.log('Running certificate issuance check...');
            try {
                await CertificateService.checkAndIssueCertificates();
                console.log('Certificate issuance check completed');
            } catch (error) {
                console.error('Error in certificate scheduler:', error);
            }
        });
        
        console.log('Certificate scheduler started. Will run ' + stagAction + 'daily at midnight.');
    }
}

module.exports = CertificateScheduler;
