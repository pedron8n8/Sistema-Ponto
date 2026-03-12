-- CreateIndex
CREATE INDEX "ApprovalLog_timeEntryId_idx" ON "ApprovalLog"("timeEntryId");

-- CreateIndex
CREATE INDEX "ApprovalLog_reviewerId_idx" ON "ApprovalLog"("reviewerId");

-- CreateIndex
CREATE INDEX "ApprovalLog_timestamp_idx" ON "ApprovalLog"("timestamp");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_idx" ON "TimeEntry"("userId");

-- CreateIndex
CREATE INDEX "TimeEntry_status_idx" ON "TimeEntry"("status");

-- CreateIndex
CREATE INDEX "TimeEntry_clockIn_idx" ON "TimeEntry"("clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_status_idx" ON "TimeEntry"("userId", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_clockIn_idx" ON "TimeEntry"("userId", "clockIn");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_supervisorId_idx" ON "User"("supervisorId");
