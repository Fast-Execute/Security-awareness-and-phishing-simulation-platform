-- Built-in library (org_id is null). All brands are fictional.
-- Placeholders: {{first_name}}, {{tracking_url}}. The send function substitutes them per recipient.

insert into templates (org_id, name, subject, body_html, difficulty, red_flags) values
(null, 'Parcel delivery notice', 'Your Brightbox parcel could not be delivered',
 '<p>Hi {{first_name}},</p><p>We tried to deliver your parcel today but nobody was home. Confirm a new delivery slot within 24 hours or it will be returned.</p><p><a href="{{tracking_url}}">Reschedule delivery</a></p><p>Brightbox Logistics</p>',
 1, array['Unexpected delivery you did not order','Artificial 24-hour deadline','Generic greeting and sender','Link text does not show the real destination']),
(null, 'Password expiry', 'Action required: your password expires today',
 '<p>Hi {{first_name}},</p><p>Your account password expires in 2 hours. Keep your current password by confirming your account below.</p><p><a href="{{tracking_url}}">Keep my password</a></p><p>IT Service Desk</p>',
 2, array['Urgency and threat of losing access','Asks you to confirm credentials via a link','Real IT teams do not ask for this by email']),
(null, 'Shared document', 'Meridian Payroll shared "Salary review Q4" with you',
 '<p>{{first_name}}, a colleague shared a file with you.</p><p><a href="{{tracking_url}}">Open "Salary review Q4"</a></p><p>This link works for 48 hours.</p>',
 3, array['Curiosity bait (salary information)','Sender is not a person you recognise','Unexpected file share','Time-limited link']),
(null, 'Invoice overdue', 'Overdue invoice #40817: final notice',
 '<p>Dear {{first_name}},</p><p>Our records show invoice #40817 is 30 days overdue. Please review the attached statement to avoid suspension of services.</p><p><a href="{{tracking_url}}">View statement</a></p><p>Accounts Receivable, Cloudvault Ltd</p>',
 2, array['Invoice for something you do not recognise','Threat of suspension','Pressure to act without checking with finance']),
(null, 'Travel rewards', 'Summit Rewards: claim your 5,000 bonus points',
 '<p>Congratulations {{first_name}}!</p><p>You have been selected for 5,000 bonus points. Claim them before the offer ends.</p><p><a href="{{tracking_url}}">Claim my points</a></p>',
 1, array['Too good to be true','Unsolicited prize','Offer expires soon']),
(null, 'Executive request', 'Quick favour, are you at your desk?',
 '<p>{{first_name}}, are you available? I need you to handle something confidential and time-sensitive. Reply here or open the details below.</p><p><a href="{{tracking_url}}">Task details</a></p><p>Sent from my phone</p>',
 4, array['Impersonates a senior person','Vague request, secrecy and urgency','Unusual channel or request','Verify by calling the person on a known number']);

insert into training_modules (org_id, title, content_md, est_minutes) values
(null, 'Spotting a phishing email',
 E'## Spotting a phishing email\n\nCheck the **sender address**, not just the display name.\nHover over links to see the real destination.\nBe suspicious of **urgency**, **threats** and **rewards**.\nWhen unsure, do not click. Report it.', 4),
(null, 'Safe links and attachments',
 E'## Safe links and attachments\n\nType known addresses yourself or use a bookmark.\nDo not open unexpected attachments.\nIf a file was shared with you, confirm with the sender via another channel.', 3),
(null, 'Strong passwords and MFA',
 E'## Strong passwords and MFA\n\nUse a password manager and a unique password per site.\nTurn on multi-factor authentication everywhere.\nNo legitimate team will ask for your password.', 5),
(null, 'How and why to report',
 E'## How and why to report\n\nReporting a suspicious message helps protect everyone.\nUse the report button, or forward it to your security team.\nReporting is always the right call, even if it turns out to be genuine.', 2);
