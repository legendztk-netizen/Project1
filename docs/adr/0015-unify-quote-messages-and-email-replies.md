# Unify Quote Messages and Email Replies

Each My Quote has one authoritative Quote Conversation in the website database.
Personal Center messages generate email notifications with a unique reply
address, and authorized email replies are ingested into the same conversation
through a verified inbound-email webhook. Unknown or unauthorized replies are
quarantined, attachments remain private, and provider event identifiers prevent
duplicate messages.
