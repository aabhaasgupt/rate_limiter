pipeline {
    agent any

    stages {
        stage('Checkout Verification') {
            steps {
                echo "Repository successfully checked out!"
                sh 'pwd'
                sh 'ls -la'
                sh 'git log --oneline -5'
            }
        }
    }
}